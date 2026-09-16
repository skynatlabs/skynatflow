// The things that are only true here.
//
// Payroll under South African tax tables, the hours the power is off, what a
// marketplace takes, what a courier actually charges on, and what can be said
// about a company without a bureau. Every one of these is somewhere a product
// built for another country gets it wrong, so the tests are about the local
// rule rather than the arithmetic.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { buildPayslip, emp201From, payeFor, tableFor, taxYearOf, uifFor, TAX_TABLES } from "../../src/lib/core/payroll";
import { clashesWithOutage, costOfDarkness, firstClearSlot, getSchedule, isDark, nextOutage, setSchedule } from "../../src/lib/core/loadShedding";
import { channelMix, parseSettlement, trueMargin } from "../../src/lib/core/marketplaces";
import { chargeableWeight, collectionManifest, suggestCourier, trackingUrl } from "../../src/lib/core/couriers";
import { checkRegistrationNumber, checkVatNumber, paymentBehaviour, whoAreThey } from "../../src/lib/core/companyLookup";
import { vat201 } from "../../src/lib/core/sarsFiling";

const DAY = 86_400_000;

let tenantId: string;
let partyId: string;
let membershipId: string;
let userId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Bokamoso Works", niche: "SERVICES", currency: "ZAR", vatNumber: "4123456784" } });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `payroll-${tenant.id}@example.com`, name: "Sipho Ndlovu" } });
  userId = user.id;
  membershipId = (await prisma.membership.create({ data: { tenantId, userId: user.id, role: "STAFF", costRateCents: 25_000 } })).id;

  partyId = (
    await prisma.party.create({
      data: { tenantId, name: "Naledi Trading", companyName: "Naledi Trading CC", role: "CUSTOMER", vatNumber: "4123456784", registrationNumber: "2019/123456/07" },
    })
  ).id;
});

afterEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId, parentId: { not: null } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.deliveryNote.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.timeEntry.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("paying people", () => {
  it("knows that a tax year starts in March, which catches everybody out once", () => {
    // 3 March 2026 belongs to the year ending February 2027.
    expect(taxYearOf(new Date("2026-03-03T00:00:00Z"))).toBe(2027);
    expect(taxYearOf(new Date("2026-02-27T00:00:00Z"))).toBe(2026);
  });

  it("takes nothing from somebody under the threshold", () => {
    const table = tableFor(2026)!;
    const result = payeFor({ monthlyCents: 700_000, table });
    expect(result.monthlyCents).toBe(0);
    expect(result.workings.join(" ")).toMatch(/under the .* threshold/i);
  });

  it("works the tax out annually and then divides, which is how SARS does it", () => {
    const table = tableFor(2026)!;
    const result = payeFor({ monthlyCents: 3_000_000, table });
    // R360,000 a year: 18% of the first bracket, less the primary rebate.
    expect(result.annualIncomeCents).toBe(36_000_000);
    expect(result.monthlyCents).toBeGreaterThan(0);
    expect(result.annualTaxCents).toBe(result.monthlyCents * 12 + (result.annualTaxCents - result.monthlyCents * 12));
    // Every step is shown, because a PAYE figure nobody can check is one
    // nobody will deduct.
    expect(result.workings.length).toBeGreaterThanOrEqual(3);
    expect(result.workings.join(" ")).toMatch(/rebate/i);
  });

  it("gives an older person the extra rebate", () => {
    const table = tableFor(2026)!;
    const young = payeFor({ monthlyCents: 3_000_000, table, age: 40 });
    const older = payeFor({ monthlyCents: 3_000_000, table, age: 70 });
    expect(older.monthlyCents).toBeLessThan(young.monthlyCents);
    expect(older.rebateCents).toBeGreaterThan(young.rebateCents);
  });

  it("stops UIF at the ceiling rather than taking 1% of everything", () => {
    const table = tableFor(2026)!;
    const under = uifFor(1_000_000, table);
    const over = uifFor(9_000_000, table);
    expect(under.employeeCents).toBe(10_000);
    expect(over.cappedAtCents).toBe(table.uifCeilingCentsPerMonth);
    expect(over.employeeCents).toBe(Math.round(table.uifCeilingCentsPerMonth / 100));
    expect(over.employerCents).toBe(over.employeeCents);
  });

  it("refuses a year it has no tables for instead of using last year's", async () => {
    const future = new Date(Date.UTC(2099, 5, 30));
    await expect(
      buildPayslip({ tenantId, membershipId, periodStart: future, periodEnd: future, salaryCents: 2_000_000 }),
    ).rejects.toThrow(/no tax tables loaded/i);
  });

  it("pays an hourly person for what they actually clocked, and says what was left out", async () => {
    const table = TAX_TABLES[0];
    const anchor = new Date(Date.UTC(table.year - 1, 5, 1));
    const end = new Date(Date.UTC(table.year - 1, 5, 30, 23, 59, 59));

    // Two full days, and one shift never clocked off.
    await prisma.timeEntry.create({
      data: { tenantId, membershipId, clockInAt: new Date(Date.UTC(table.year - 1, 5, 2, 8)), clockOutAt: new Date(Date.UTC(table.year - 1, 5, 2, 16)) },
    });
    await prisma.timeEntry.create({
      data: { tenantId, membershipId, clockInAt: new Date(Date.UTC(table.year - 1, 5, 3, 8)), clockOutAt: new Date(Date.UTC(table.year - 1, 5, 3, 16)) },
    });
    await prisma.timeEntry.create({ data: { tenantId, membershipId, clockInAt: new Date(Date.UTC(table.year - 1, 5, 4, 8)) } });

    const slip = await buildPayslip({ tenantId, membershipId, periodStart: anchor, periodEnd: end, hourlyRateCents: 15_000 });
    expect(slip.grossCents).toBe(16 * 15_000);
    expect(slip.warnings.join(" ")).toMatch(/never clocked off/i);
    expect(slip.netCents).toBeLessThan(slip.grossCents);
    // The employer's UIF never comes off the employee.
    expect(slip.employerCostCents).toBeGreaterThan(slip.grossCents);
  });

  it("refuses to guess when somebody has both a salary and an hourly rate", async () => {
    const table = TAX_TABLES[0];
    const start = new Date(Date.UTC(table.year - 1, 5, 1));
    const end = new Date(Date.UTC(table.year - 1, 5, 30));
    const slip = await buildPayslip({ tenantId, membershipId, periodStart: start, periodEnd: end, salaryCents: 2_000_000, hourlyRateCents: 15_000 });
    expect(slip.warnings.join(" ")).toMatch(/both a salary and an hourly rate/i);
    expect(slip.grossCents).toBe(2_000_000);
  });

  it("leaves SDL off a payroll bill under the threshold, and says why", async () => {
    const table = TAX_TABLES[0];
    const start = new Date(Date.UTC(table.year - 1, 5, 1));
    const end = new Date(Date.UTC(table.year - 1, 5, 30));
    const slip = await buildPayslip({ tenantId, membershipId, periodStart: start, periodEnd: end, salaryCents: 2_000_000 });

    const declaration = emp201From([slip], { periodEnd: end });
    expect(declaration.sdlCents).toBe(0);
    expect(declaration.notes.join(" ")).toMatch(/under the .* where SDL starts/i);
    // The 7th, or the last business day before it.
    expect(declaration.dueOn.getUTCDate()).toBeLessThanOrEqual(7);
    expect([0, 6]).not.toContain(declaration.dueOn.getUTCDay());
  });
});

describe("the hours the power is off", () => {
  async function scheduleTwoBlocks() {
    // Wednesday, twice: 06:00–08:30 and 14:00–16:30.
    await setSchedule({
      tenantId,
      areaLabel: "Block 7",
      stage: 4,
      blocks: [
        { day: 3, from: "06:00", to: "08:30" },
        { day: 3, from: "14:00", to: "16:30" },
      ],
    });
    return getSchedule(tenantId);
  }

  it("says nothing is entered rather than pretending the power is on", async () => {
    const empty = await getSchedule(tenantId);
    expect(empty.source).toBe("none");
    expect(empty.note).toMatch(/no load-shedding times entered/i);
    expect(isDark(empty, new Date())).toBe(false);
  });

  it("knows whether it is dark right now, and when the next block starts", async () => {
    const schedule = await scheduleTwoBlocks();

    // A Wednesday at 07:00 and the same Wednesday at 10:00.
    const wednesday = new Date(2026, 8, 16, 7, 0);
    expect(wednesday.getDay()).toBe(3);
    expect(isDark(schedule, wednesday)).toBe(true);
    expect(isDark(schedule, new Date(2026, 8, 16, 10, 0))).toBe(false);

    const next = nextOutage(schedule, new Date(2026, 8, 16, 10, 0));
    expect(next).not.toBeNull();
    expect(next!.startsAt.getHours()).toBe(14);
  });

  it("warns about a job in a dark block without refusing to book it", async () => {
    const schedule = await scheduleTwoBlocks();

    const inTheDark = clashesWithOutage({ schedule, startsAt: new Date(2026, 8, 16, 7, 0), minutes: 60, needsPower: true });
    expect(inTheDark.clashes).toBe(true);
    expect(inTheDark.note).toMatch(/whole of this slot/i);

    // A plumber changing a tap does not care, and blocking their diary is how
    // a feature gets switched off in a week.
    const doesNotCare = clashesWithOutage({ schedule, startsAt: new Date(2026, 8, 16, 7, 0), minutes: 60, needsPower: false });
    expect(doesNotCare.clashes).toBe(false);
  });

  it("finds the first slot the work actually fits into", async () => {
    const schedule = await scheduleTwoBlocks();
    const wednesday = new Date(2026, 8, 16, 0, 0);

    // Two hours of work from 08:00 cannot start until the 08:30 block ends.
    const slot = firstClearSlot({ schedule, day: wednesday, minutes: 120 });
    expect(slot).not.toBeNull();
    expect(slot!.getHours()).toBe(8);
    expect(slot!.getMinutes()).toBe(30);
  });

  it("prices the dark hours, and says what it could not price", async () => {
    await scheduleTwoBlocks();
    const cost = await costOfDarkness({ tenantId, from: new Date(Date.now() - 28 * DAY), to: new Date() });
    expect(cost.darkHours).toBeGreaterThan(0);
    expect(cost.caveats.join(" ")).toMatch(/six-tenths/i);
  });
});

describe("selling somewhere else", () => {
  it("says plainly when a line loses money at that commission", () => {
    const bad = trueMargin({ marketplace: "takealot", category: "Clothing", sellPriceCents: 20_000, costCents: 18_000, currency: "ZAR" });
    expect(bad.commissionPercent).toBe(20);
    expect(bad.marginCents).toBeLessThan(0);
    expect(bad.verdict).toMatch(/loses money/i);
    // And says what the price would have to be.
    expect(bad.verdict).toMatch(/R/);
  });

  it("takes the commission off the price including VAT, which is where sellers go wrong", () => {
    const withoutVat = trueMargin({ marketplace: "takealot", category: "Electronics", sellPriceCents: 100_000, costCents: 50_000, currency: "ZAR" });
    const withVat = trueMargin({ marketplace: "takealot", category: "Electronics", sellPriceCents: 100_000, costCents: 50_000, currency: "ZAR", vatPercent: 15 });
    expect(withVat.marginCents).toBeLessThan(withoutVat.marginCents);
  });

  it("reads a settlement file whatever the columns are called, and names what it could not place", () => {
    const csv = [
      "Order ID,Date,SKU,Product Title,Quantity,Selling Price,Success Fee,Something Else",
      '"TAK-001",2026-02-03,PW-1,"Pallet wrap",2,"R 450.00","R 58.50",ignored',
      '"TAK-002",2026-02-04,RS-2,"Ratchet strap",1,"250,00","32,50",ignored',
    ].join("\n");

    const { orders, unmatchedColumns, problems } = parseSettlement(csv);
    expect(problems).toEqual([]);
    expect(orders).toHaveLength(2);
    expect(orders[0].grossCents).toBe(45_000);
    expect(orders[0].commissionCents).toBe(5_850);
    expect(orders[0].netCents).toBe(39_150);
    // A comma decimal, which is how most South African exports are written.
    expect(orders[1].grossCents).toBe(25_000);
    expect(unmatchedColumns).toContain("Something Else");
  });

  it("refuses a file with no order number rather than inventing one", () => {
    const { orders, problems } = parseSettlement("Widget,Price\nThing,100");
    expect(orders).toEqual([]);
    expect(problems.join(" ")).toMatch(/no order number/i);
  });

  it("groups revenue by channel and admits what it could not place", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 100_000, subject: "Takealot order TAK-1" },
    });
    await prisma.transaction.create({ data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 300_000, subject: "Site visit" } });

    const mix = await channelMix(tenantId, new Date(Date.now() - 30 * DAY));
    expect(mix.totalCents).toBe(400_000);
    const takealot = mix.channels.find((channel) => channel.label === "Takealot")!;
    expect(takealot.share).toBe(25);
    expect(mix.caveat).toMatch(/counts as direct/i);
  });
});

describe("getting it to the customer", () => {
  it("charges on the box when the box is bigger than the weight", () => {
    // A big light box: 60 × 40 × 40 is 96,000 cm³, which is 19.2 volumetric kg.
    const bulky = chargeableWeight({ actualKg: 3, lengthCm: 60, widthCm: 40, heightCm: 40, courier: "courier-guy" });
    expect(bulky.volumetricKg).toBe(19.2);
    expect(bulky.charged).toBe("volume");
    expect(bulky.chargeableKg).toBe(19.5);
    expect(bulky.note).toMatch(/charged on its size/i);

    const dense = chargeableWeight({ actualKg: 25, lengthCm: 20, widthCm: 20, heightCm: 20, courier: "courier-guy" });
    expect(dense.charged).toBe("actual");
  });

  it("picks a courier and says why, with alternatives", () => {
    const heavy = suggestCourier({ chargeableKg: 45 });
    expect(heavy.courier).toBe("dawn-wing");
    expect(heavy.why).toMatch(/30kg/);

    const local = suggestCourier({ chargeableKg: 2, localKm: 12 });
    expect(local.courier).toBe("internal");
    expect(local.alternatives.length).toBeGreaterThan(0);
  });

  it("builds a manifest and refuses to hide a parcel with no address", async () => {
    await prisma.deliveryNote.create({
      data: { tenantId, partyId, number: "DN-001", status: "DRAFT", deliveryAddress: "12 Main Road, Benoni" },
    });
    await prisma.deliveryNote.create({ data: { tenantId, partyId, number: "DN-002", status: "DRAFT" } });

    const manifest = await collectionManifest({ tenantId, on: new Date() });
    expect(manifest.rows).toHaveLength(2);
    expect(manifest.note).toMatch(/no delivery address/i);
  });

  it("gives a tracking link only where there is a public page", () => {
    expect(trackingUrl("courier-guy", "TCG123")).toContain("TCG123");
    expect(trackingUrl("postnet", "X")).toBeNull();
    expect(trackingUrl("internal", "X")).toBeNull();
  });
});

describe("who are they", () => {
  it("catches an invented VAT number without asking anybody", () => {
    expect(checkVatNumber("4123456784").plausible).toBe(true);
    expect(checkVatNumber("4123456789").plausible).toBe(false);
    expect(checkVatNumber("4123456789").reason).toMatch(/check digit/i);
    expect(checkVatNumber("1234567890").reason).toMatch(/starts with a 4/i);
    expect(checkVatNumber("412345").reason).toMatch(/ten digits/i);
  });

  it("reads the entity type out of a registration number", () => {
    const pty = checkRegistrationNumber("2019/123456/07");
    expect(pty.plausible).toBe(true);
    expect(pty.entityType).toMatch(/Pty/);
    // And is honest that the format is all it can check.
    expect(pty.reason).toMatch(/needs CIPC, which is not connected/i);

    expect(checkRegistrationNumber("2019-123456-07").plausible).toBe(false);
    expect(checkRegistrationNumber("3019/123456/07").reason).toMatch(/not a year/i);
  });

  it("answers in days rather than a score, and says what it is not", async () => {
    // Four invoices, each paid about nine days after it was due.
    for (let i = 0; i < 4; i++) {
      const due = new Date(Date.now() - (60 - i * 10) * DAY);
      const invoice = await prisma.transaction.create({
        data: { tenantId, partyId, type: "INVOICE", status: "PAID", amountCents: 100_000, dueAt: due, createdAt: new Date(due.getTime() - 30 * DAY) },
      });
      await prisma.transaction.create({
        data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 100_000, parentId: invoice.id, createdAt: new Date(due.getTime() + 9 * DAY) },
      });
    }

    const behaviour = await paymentBehaviour(tenantId, partyId);
    expect(behaviour.settled).toBe(4);
    expect(behaviour.medianDaysLate).toBe(9);
    expect(behaviour.verdict).toMatch(/9 days late/);
    expect(behaviour.caveat).toMatch(/National Credit Act/);
  });

  it("calls two invoices a first impression rather than a pattern", async () => {
    const due = new Date(Date.now() - 20 * DAY);
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "PAID", amountCents: 50_000, dueAt: due, createdAt: new Date(due.getTime() - 30 * DAY) },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 50_000, parentId: invoice.id, createdAt: due },
    });

    const behaviour = await paymentBehaviour(tenantId, partyId);
    expect(behaviour.verdict).toMatch(/first impression/i);
  });

  it("collects everything into one answer, with what is not connected listed", async () => {
    const answer = await whoAreThey(tenantId, partyId);
    expect(answer.vat?.plausible).toBe(true);
    expect(answer.registration?.entityType).toMatch(/Pty/);
    expect(answer.notConnected.join(" ")).toMatch(/CIPC/);
    expect(answer.notConnected.join(" ")).toMatch(/subscriber agreement/i);
  });
});

describe("the figures SARS asks for", () => {
  it("puts each number against the box it goes in, with what was counted", async () => {
    await prisma.transaction.create({ data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 115_000 } });

    const pack = await vat201({ tenantId });
    expect(pack.form).toBe("VAT201");
    const boxes = pack.fields.map((field) => field.box);
    expect(boxes).toContain("1");
    expect(boxes).toContain("4");
    expect(boxes).toContain("14");
    for (const field of pack.fields) expect(field.basis.length).toBeGreaterThan(10);
    // Due the 25th, never on a weekend.
    expect([0, 6]).not.toContain(pack.dueOn.getUTCDay());
    expect(pack.where).toMatch(/eFiling/);
  });

  it("names a VAT claim that would be disallowed before it is filed", async () => {
    const supplier = await prisma.party.create({ data: { tenantId, name: "Cash Hardware", role: "SUPPLIER" } });
    await prisma.expense.create({
      data: {
        tenantId,
        submittedById: membershipId,
        supplierId: supplier.id,
        descriptionText: "Fittings",
        amountCents: 115_000,
        taxCents: 15_000,
        status: "APPROVED",
        spentOn: new Date(),
      },
    });

    const pack = await vat201({ tenantId });
    expect(pack.warnings.join(" ")).toMatch(/no VAT number recorded/i);
    expect(pack.warnings.join(" ")).toMatch(/no slip attached/i);
    expect(pack.supporting.rows).toBeGreaterThan(0);
  });
});
