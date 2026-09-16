// Payment plans, payables, VAT and the chasing ladder.
//
// These four share one property worth protecting above everything else: they
// decide what a business believes about money it has not got yet. A plan that
// does not add up, a bill counted as a cost before it was paid, a VAT return
// that restates after filing, or a chaser sent to somebody paying exactly as
// agreed — each of those is a number the owner acts on and each is wrong in
// the direction that costs the most.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { cancelPaymentPlan, createPaymentPlan, evenInstalments, paymentPlanFor } from "../../src/lib/core/paymentPlans";
import { approveBill, buildPaymentRun, payablesAgeing, payBill, recordBill, releasePaymentRun } from "../../src/lib/core/supplierBills";
import { computeVatReturn, driftSinceFiling, fileVatReturn, vatPeriodFor } from "../../src/lib/core/vatReturn";
import { LADDER, chaseList, draftChase, recordChase } from "../../src/lib/core/collectionsLadder";
import { applyCoding, matchKeyFor, rememberCorrection, suggestCoding } from "../../src/lib/core/expenseCoding";

const DAY = 86_400_000;

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let supplierId: string;
let membershipId: string;
let itemId: string;

async function invoice(amountCents: number, dueDaysAgo: number, party = partyId) {
  return prisma.transaction.create({
    data: {
      tenantId,
      partyId: party,
      type: "INVOICE",
      status: "SENT",
      amountCents,
      createdAt: new Date(Date.now() - (dueDaysAgo + 30) * DAY),
      dueAt: new Date(Date.now() - dueDaysAgo * DAY),
    },
  });
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES", currency: "ZAR", vatNumber: "4123456789" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const user = await prisma.user.create({ data: { email: `owner-${t.id}@example.test` } });
  membershipId = (await prisma.membership.create({ data: { tenantId, userId: user.id, role: "OWNER" } })).id;

  partyId = (await prisma.party.create({ data: { tenantId, name: "Jabu Ndlovu", role: "CUSTOMER" } })).id;
  supplierId = (await prisma.party.create({ data: { tenantId, name: "Build-It Midrand", role: "SUPPLIER" } })).id;
  itemId = (await prisma.item.create({ data: { tenantId, name: "Callout", unitPriceCents: 50_000, taxRatePercent: 15 } })).id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.collectionAttempt.deleteMany({ where: { tenantId: id } });
    await prisma.paymentPlanInstalment.deleteMany({ where: { plan: { tenantId: id } } });
    await prisma.paymentPlan.deleteMany({ where: { tenantId: id } });
    await prisma.supplierBill.deleteMany({ where: { tenantId: id } });
    await prisma.paymentRun.deleteMany({ where: { tenantId: id } });
    await prisma.vatReturn.deleteMany({ where: { tenantId: id } });
    await prisma.expenseCodingRule.deleteMany({ where: { tenantId: id } });
    await prisma.expense.deleteMany({ where: { tenantId: id } });
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId: id } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id, parentId: { not: null } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.item.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    const members = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
    await prisma.membership.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
    for (const m of members) await prisma.user.delete({ where: { id: m.userId } }).catch(() => {});
  }
});

describe("payment plans", () => {
  it("spreads a total exactly, with the rounding up front", () => {
    const rows = evenInstalments({ totalCents: 100_001, count: 3, firstDueOn: new Date("2026-10-01") });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(100_001);
    // A business would rather be a cent up front than a cent short at the end.
    expect(rows[0].amountCents).toBeGreaterThan(rows[2].amountCents);
    expect(rows[1].dueOn.getMonth()).toBe(10);
  });

  it("refuses a plan that does not come to the invoice", async () => {
    const inv = await invoice(300_000, 5);
    await expect(
      createPaymentPlan({
        tenantId,
        transactionId: inv.id,
        instalments: [{ dueOn: new Date(), amountCents: 100_000 }],
      })
    ).rejects.toThrow(/have to match/i);
  });

  it("makes only the instalments whose day has passed count as late", async () => {
    const inv = await invoice(300_000, 40);
    await createPaymentPlan({
      tenantId,
      transactionId: inv.id,
      depositCents: 100_000,
      instalments: [
        { dueOn: new Date(Date.now() - 5 * DAY), amountCents: 100_000 },
        { dueOn: new Date(Date.now() + 25 * DAY), amountCents: 100_000 },
      ],
    });
    // The deposit has been paid; the first instalment has not.
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 100_000, parentId: inv.id },
    });

    const plan = await paymentPlanFor(tenantId, inv.id);
    expect(plan!.overdueCents).toBe(100_000);
    expect(plan!.notYetDueCents).toBe(100_000);
    expect(plan!.instalments[0].overdue).toBe(true);
    expect(plan!.instalments[1].overdue).toBe(false);

    await cancelPaymentPlan(tenantId, inv.id);
    expect(await paymentPlanFor(tenantId, inv.id)).toBeNull();
  });
});

describe("what is owed to suppliers", () => {
  it("is not a cost until it is paid, and is one the moment it is", async () => {
    const bill = await recordBill({
      tenantId,
      supplierId,
      reference: "INV-771",
      amountCents: 250_000,
      taxCents: 32_609,
      dueOn: new Date(Date.now() + 10 * DAY),
    });
    // A bill outstanding is not money that has gone.
    expect(await prisma.expense.count({ where: { tenantId } })).toBe(0);

    await approveBill(tenantId, bill.id, membershipId);
    const paid = await payBill({ tenantId, billId: bill.id, submittedById: membershipId });
    expect(paid.status).toBe("PAID");

    const expense = await prisma.expense.findFirstOrThrow({ where: { tenantId } });
    expect(expense.amountCents).toBe(250_000);
    expect(expense.supplierId).toBe(supplierId);
    expect(expense.reference).toBe("INV-771");
  });

  it("ages what is outstanding by how late it is", async () => {
    await recordBill({ tenantId, supplierId, amountCents: 100_000, dueOn: new Date(Date.now() + 5 * DAY) });
    const late = await recordBill({ tenantId, supplierId, amountCents: 40_000, dueOn: new Date(Date.now() - 45 * DAY) });
    await approveBill(tenantId, late.id);

    const ageing = await payablesAgeing(tenantId);
    expect(ageing).toHaveLength(1);
    expect(ageing[0].totalCents).toBe(140_000);
    expect(ageing[0].buckets.find((b) => b.label === "Not yet due")!.cents).toBe(100_000);
    expect(ageing[0].buckets.find((b) => b.label === "31–60 days")!.cents).toBe(40_000);
  });

  it("pays a whole run at once, and will not release it twice", async () => {
    for (const cents of [50_000, 70_000]) {
      const bill = await recordBill({ tenantId, supplierId, amountCents: cents, dueOn: new Date(Date.now() - DAY) });
      await approveBill(tenantId, bill.id);
    }
    const run = await buildPaymentRun({ tenantId, runOn: new Date() });
    expect(run).toMatchObject({ bills: 2, totalCents: 120_000 });

    await releasePaymentRun({ tenantId, runId: run.runId, submittedById: membershipId });
    expect(await prisma.expense.count({ where: { tenantId } })).toBe(2);
    await expect(releasePaymentRun({ tenantId, runId: run.runId, submittedById: membershipId })).rejects.toThrow(/already gone/i);
  });
});

describe("the VAT return", () => {
  it("counts output tax on what was invoiced and input tax only where it was recorded", async () => {
    const { start, end } = vatPeriodFor(new Date());
    const inv = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 115_000, createdAt: new Date() },
    });
    await prisma.transactionLine.create({
      data: { transactionId: inv.id, itemId, quantity: 2, unitPriceCents: 50_000, taxRatePercent: 15, sortOrder: 0 },
    });
    await prisma.expense.createMany({
      data: [
        { tenantId, submittedById: membershipId, descriptionText: "Pipe", amountCents: 23_000, taxCents: 3_000, spentOn: new Date() },
        { tenantId, submittedById: membershipId, descriptionText: "Nothing on the slip", amountCents: 5_000, spentOn: new Date() },
        { tenantId, submittedById: membershipId, descriptionText: "Owner lunch", amountCents: 4_000, taxCents: 522, spentOn: new Date(), isOwnerDrawing: true },
      ],
    });

    const computed = await computeVatReturn(tenantId, start, end);
    expect(computed.outputCents).toBe(15_000);
    // Only the cost with tax on the slip. A guess at the VAT inside an
    // untaxed total is how a return becomes a liability.
    expect(computed.inputCents).toBe(3_000);
    expect(computed.netCents).toBe(12_000);
    expect(computed.caveats.join(" ")).toMatch(/no tax amount recorded/i);
    expect(computed.caveats.join(" ")).toMatch(/owner drawings/i);
  });

  it("stops moving once it is filed, and says what has changed since", async () => {
    const { start, end } = vatPeriodFor(new Date());
    const inv = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 115_000, createdAt: new Date() },
    });
    await prisma.transactionLine.create({
      data: { transactionId: inv.id, itemId, quantity: 2, unitPriceCents: 50_000, taxRatePercent: 15, sortOrder: 0 },
    });

    const filed = await fileVatReturn({ tenantId, periodStart: start, periodEnd: end, reference: "SARS-123" });
    expect(filed.status).toBe("FILED");
    expect(filed.netCents).toBe(15_000);

    // A backdated invoice arrives, which is ordinary.
    const late = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 23_000, createdAt: new Date() },
    });
    await prisma.transactionLine.create({
      data: { transactionId: late.id, itemId, quantity: 1, unitPriceCents: 20_000, taxRatePercent: 15, sortOrder: 0 },
    });

    const stored = await prisma.vatReturn.findUniqueOrThrow({
      where: { tenantId_periodStart_periodEnd: { tenantId, periodStart: start, periodEnd: end } },
    });
    // The filed figure is a record, not a calculation.
    expect(stored.netCents).toBe(15_000);

    const drift = await driftSinceFiling(tenantId, stored.id);
    expect(drift!.changed).toBe(true);
    expect(drift!.differenceCents).toBe(3_000);
    expect(drift!.note).toMatch(/carry it into the next return/i);
  });
});

describe("the chasing ladder", () => {
  it("climbs a rung at a time and never chases somebody paying as agreed", async () => {
    const chaseable = await invoice(450_000, 40);
    const onPlan = await invoice(200_000, 40);
    await createPaymentPlan({
      tenantId,
      transactionId: onPlan.id,
      instalments: [
        { dueOn: new Date(Date.now() - 10 * DAY), amountCents: 100_000 },
        { dueOn: new Date(Date.now() + 20 * DAY), amountCents: 100_000 },
      ],
    });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 100_000, parentId: onPlan.id },
    });

    let list = await chaseList(tenantId);
    const first = list.find((c) => c.transactionId === chaseable.id)!;
    const skipped = list.find((c) => c.transactionId === onPlan.id)!;

    expect(first.rung!.step).toBe(1);
    expect(skipped.rung).toBeNull();
    expect(skipped.skip).toMatch(/payment plan/i);

    // One rung at a time, however late it is.
    await recordChase({ tenantId, transactionId: chaseable.id, step: 1, channel: "whatsapp", tone: "gentle" });
    list = await chaseList(tenantId);
    expect(list.find((c) => c.transactionId === chaseable.id)!.rung!.step).toBe(2);
  });

  it("stops the moment the money lands", async () => {
    const inv = await invoice(120_000, 50);
    expect((await chaseList(tenantId)).some((c) => c.transactionId === inv.id)).toBe(true);

    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 120_000, parentId: inv.id },
    });
    expect((await chaseList(tenantId)).some((c) => c.transactionId === inv.id)).toBe(false);
  });

  it("writes wording that matches the rung, and hardens as it climbs", async () => {
    const inv = await invoice(450_000, 60);
    const candidate = (await chaseList(tenantId)).find((c) => c.transactionId === inv.id)!;

    const gentle = draftChase({ candidate, businessName: "Kagiso Plumbing", currency: "ZAR" });
    expect(gentle.tone).toBe("gentle");
    expect(gentle.body).toMatch(/probably nothing/i);

    const final = draftChase({
      candidate: { ...candidate, rung: LADDER[3] },
      businessName: "Kagiso Plumbing",
      currency: "ZAR",
    });
    expect(final.tone).toBe("final");
    expect(final.body).toMatch(/suspend further work/i);
    // Even the final notice asks them to call rather than only threatening.
    expect(final.body).toMatch(/call us today/i);
  });
});

describe("remembering how a cost is coded", () => {
  it("keys on the supplier, applies only to empty fields, and counts its own use", async () => {
    expect(matchKeyFor({ supplierName: "  Engen Midrand " })).toBe("engen midrand");
    expect(matchKeyFor({ supplierName: "ab" })).toBeNull();

    const account = await prisma.account.create({
      data: { tenantId, code: "5200", name: "Fuel", type: "EXPENSE" },
    });
    await rememberCorrection({ tenantId, supplierName: "Engen Midrand", accountId: account.id, category: "Fuel" });

    const suggestion = await suggestCoding({ tenantId, supplierName: "engen midrand" });
    expect(suggestion?.accountId).toBe(account.id);

    const expense = await prisma.expense.create({
      data: { tenantId, submittedById: membershipId, descriptionText: "Diesel", amountCents: 90_000, supplierName: "Engen Midrand", category: "Already set" },
    });
    const applied = await applyCoding(tenantId, expense.id);
    expect(applied.applied).toBe(true);
    // It filled the account and left the category somebody had already set.
    expect(applied.applied && applied.fields).toEqual(["accountId"]);

    const after = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(after.accountId).toBe(account.id);
    expect(after.category).toBe("Already set");

    const rule = await prisma.expenseCodingRule.findFirstOrThrow({ where: { tenantId } });
    expect(rule.timesApplied).toBe(1);

    await prisma.account.delete({ where: { id: account.id } }).catch(() => {});
  });
});
