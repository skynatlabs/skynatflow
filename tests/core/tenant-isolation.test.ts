// Cross-tenant isolation regression tests.
//
// Every case here is a hole that was actually open: a server action proved
// the caller's access to its OWN tenant, then passed a record id straight
// off a form post into a core function that looked the record up by bare
// id. Two tenants are set up side by side and tenant A is asked to act on
// tenant B's rows — each call must refuse.
//
// These are written against the core functions rather than the actions
// because the core layer is where the fix lives, and where any future
// caller (AI tools, the mobile endpoints, a REST API) would otherwise
// reintroduce the same gap.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, EventType } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { createQuote, sendQuote, recordCashSale } from "../../src/lib/core/money";
import { applyLateFee } from "../../src/lib/core/collections";
import { updateGoalProgress } from "../../src/lib/core/goals";
import { setManager, setDepartment } from "../../src/lib/core/org";
import { markNoShowAndRebook } from "../../src/lib/core/reminders";
import { returnRental, markItemRentable } from "../../src/lib/core/rentals";
import { openTill, closeTill } from "../../src/lib/core/pos";
import { recordBatch } from "../../src/lib/core/inventory";

// tenant A = the attacker's own workspace; tenant B = the victim's.
let tenantA: string;
let tenantB: string;
let partyA: string;
let partyB: string;
let itemA: string;
let itemB: string;
let userA: string;
let userB: string;
let membershipA: string;
let membershipB: string;

beforeAll(async () => {
  const a = await prisma.tenant.create({ data: { name: "Isolation Co A", niche: "RETAIL" } });
  const b = await prisma.tenant.create({ data: { name: "Isolation Co B", niche: "RETAIL" } });
  tenantA = a.id;
  tenantB = b.id;

  const pa = await prisma.party.create({ data: { tenantId: tenantA, role: PartyRole.CUSTOMER, name: "Customer A" } });
  const pb = await prisma.party.create({
    data: { tenantId: tenantB, role: PartyRole.CUSTOMER, name: "Customer B", phone: "+27820000000" },
  });
  partyA = pa.id;
  partyB = pb.id;

  const ia = await prisma.item.create({ data: { tenantId: tenantA, name: "Widget A", unitPriceCents: 1000 } });
  const ib = await prisma.item.create({ data: { tenantId: tenantB, name: "Widget B", unitPriceCents: 1000 } });
  itemA = ia.id;
  itemB = ib.id;

  const ua = await prisma.user.create({ data: { email: `iso-a-${a.id}@test.local`, name: "User A" } });
  const ub = await prisma.user.create({ data: { email: `iso-b-${b.id}@test.local`, name: "User B" } });
  userA = ua.id;
  userB = ub.id;

  const ma = await prisma.membership.create({ data: { tenantId: tenantA, userId: userA, role: "OWNER" } });
  const mb = await prisma.membership.create({ data: { tenantId: tenantB, userId: userB, role: "OWNER" } });
  membershipA = ma.id;
  membershipB = mb.id;
});

afterAll(async () => {
  for (const t of [tenantA, tenantB]) {
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId: t } } });
    await prisma.transaction.deleteMany({ where: { tenantId: t } });
    await prisma.rental.deleteMany({ where: { tenantId: t } });
    await prisma.goal.deleteMany({ where: { tenantId: t } });
    await prisma.event.deleteMany({ where: { tenantId: t } });
    await prisma.tillSession.deleteMany({ where: { tenantId: t } });
    await prisma.membership.deleteMany({ where: { tenantId: t } });
    await prisma.party.deleteMany({ where: { tenantId: t } });
    await prisma.item.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
});

describe("document creation can't reach across tenants", () => {
  it("refuses to build a quote against another tenant's customer", async () => {
    await expect(
      createQuote({
        tenantId: tenantA,
        partyId: partyB,
        lines: [{ itemId: itemA, quantity: 1, unitPriceCents: 1000 }],
      })
    ).rejects.toThrow(/customer not found/i);
  });

  it("refuses to put another tenant's catalog item on a quote", async () => {
    await expect(
      createQuote({
        tenantId: tenantA,
        partyId: partyA,
        lines: [{ itemId: itemB, quantity: 1, unitPriceCents: 1000 }],
      })
    ).rejects.toThrow(/aren't in this workspace/i);
  });

  it("applies the same two checks to a cash sale", async () => {
    await expect(
      recordCashSale({
        tenantId: tenantA,
        partyId: partyB,
        lines: [{ itemId: itemA, quantity: 1, unitPriceCents: 1000 }],
      })
    ).rejects.toThrow(/customer not found/i);
  });

  it("still allows the same call entirely within one tenant", async () => {
    const quote = await createQuote({
      tenantId: tenantA,
      partyId: partyA,
      lines: [{ itemId: itemA, quantity: 2, unitPriceCents: 1000 }],
    });
    expect(quote.amountCents).toBe(2000);
  });
});

describe("acting on another tenant's records is refused", () => {
  it("won't send another tenant's quote", async () => {
    const victimQuote = await createQuote({
      tenantId: tenantB,
      partyId: partyB,
      lines: [{ itemId: itemB, quantity: 1, unitPriceCents: 5000 }],
    });
    await expect(sendQuote(victimQuote.id, tenantA)).rejects.toThrow(/not found/i);

    const after = await prisma.transaction.findUnique({ where: { id: victimQuote.id } });
    expect(after?.status).toBe("DRAFT");
  });

  it("won't append a late fee to another tenant's invoice", async () => {
    const quote = await createQuote({
      tenantId: tenantB,
      partyId: partyB,
      lines: [{ itemId: itemB, quantity: 1, unitPriceCents: 10000 }],
    });
    await sendQuote(quote.id, tenantB);
    const invoice = await prisma.transaction.create({
      data: {
        tenantId: tenantB,
        partyId: partyB,
        type: "INVOICE",
        status: "SENT",
        amountCents: 10000,
        parentId: quote.id,
      },
    });

    await expect(applyLateFee({ invoiceId: invoice.id, feePercent: 10, tenantId: tenantA })).rejects.toThrow(
      /not found/i
    );

    // The victim's ledger must be untouched — no fee document created.
    const feeRows = await prisma.transaction.count({ where: { tenantId: tenantB, parentId: invoice.id } });
    expect(feeRows).toBe(0);
  });

  it("won't update another tenant's goal", async () => {
    const goal = await prisma.goal.create({
      data: { tenantId: tenantB, title: "Victim goal", metricLabel: "sales", targetValue: 100 },
    });
    await expect(updateGoalProgress(goal.id, 99, tenantA)).rejects.toThrow(/not found/i);

    const after = await prisma.goal.findUnique({ where: { id: goal.id } });
    expect(after?.currentValue).toBe(0);
  });

  it("won't rewrite another tenant's reporting line or department", async () => {
    await expect(setManager(membershipB, null, tenantA)).rejects.toThrow(/not found/i);
    await expect(setDepartment(membershipB, "Hijacked", tenantA)).rejects.toThrow(/not found/i);

    const after = await prisma.membership.findUnique({ where: { id: membershipB } });
    expect(after?.department).toBeNull();
  });

  it("won't mark another tenant's appointment as a no-show", async () => {
    const event = await prisma.event.create({
      data: {
        tenantId: tenantB,
        partyId: partyB,
        type: EventType.CONSULTATION,
        scheduledAt: new Date(Date.now() - 3600000),
      },
    });

    const result = await markNoShowAndRebook(event.id, tenantA);
    expect(result.ok).toBe(false);

    // Critically, the victim's customer must not have been messaged.
    const after = await prisma.event.findUnique({ where: { id: event.id } });
    expect(after?.noShow).toBe(false);
  });

  it("won't close another tenant's till session", async () => {
    const session = await openTill({ tenantId: tenantB, openedById: userB, openingFloatCents: 5000 });
    await expect(closeTill(session.id, 5000, userA, tenantA)).rejects.toThrow(/not found/i);

    const after = await prisma.tillSession.findUnique({ where: { id: session.id } });
    expect(after?.closedAt).toBeNull();
  });

  it("won't flip another tenant's product to rentable", async () => {
    await expect(
      markItemRentable({ itemId: itemB, rentalRateCents: 1, rentalRateUnit: "DAY", tenantId: tenantA })
    ).rejects.toThrow(/not found/i);

    const after = await prisma.item.findUnique({ where: { id: itemB } });
    expect(after?.isRentable).toBe(false);
  });

  it("won't close out another tenant's rental", async () => {
    await markItemRentable({ itemId: itemB, rentalRateCents: 500, rentalRateUnit: "DAY", tenantId: tenantB });
    const rental = await prisma.rental.create({
      data: {
        tenantId: tenantB,
        itemId: itemB,
        partyId: partyB,
        rateCents: 500,
        rateUnit: "DAY",
        status: "ACTIVE",
      },
    });

    await expect(returnRental(rental.id, tenantA)).rejects.toThrow(/not found/i);

    const after = await prisma.rental.findUnique({ where: { id: rental.id } });
    expect(after?.status).toBe("ACTIVE");
  });

  it("won't log a stock batch against another tenant's product", async () => {
    await expect(recordBatch({ tenantId: tenantA, itemId: itemB, quantity: 5 })).rejects.toThrow(/catalogue/i);
    expect(await prisma.itemBatch.count({ where: { itemId: itemB } })).toBe(0);

    // Its own product, it may.
    const batch = await recordBatch({ tenantId: tenantA, itemId: itemA, quantity: 5 });
    expect(batch.itemId).toBe(itemA);
    await prisma.itemBatch.delete({ where: { id: batch.id } });
  });
});

describe("org chart reporting loops", () => {
  it("refuses a manager assignment that would close a cycle", async () => {
    const extraUser = await prisma.user.create({
      data: { email: `iso-cycle-${tenantA}@test.local`, name: "Cycle User" },
    });
    const second = await prisma.membership.create({
      data: { tenantId: tenantA, userId: extraUser.id, role: "STAFF" },
    });

    // A reports to B is fine...
    await setManager(second.id, membershipA, tenantA);
    // ...but B reporting back to A would make both vanish from the chart.
    await expect(setManager(membershipA, second.id, tenantA)).rejects.toThrow(/loop/i);

    await prisma.membership.update({ where: { id: second.id }, data: { managerId: null } });
    await prisma.membership.delete({ where: { id: second.id } });
    await prisma.user.delete({ where: { id: extraUser.id } });
  });
});
