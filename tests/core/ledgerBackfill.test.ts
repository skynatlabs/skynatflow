// Posting existing history into the books.
//
// The two properties that matter: running it twice must not double the
// revenue, and it must never write into a month somebody has already reported
// on. Both are the kind of bug that is invisible until a number a bank has
// seen changes underneath it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { backfillLedger, ledgerCoverage } from "../../src/lib/core/ledgerBackfill";
import { closePeriod, ensureChartOfAccounts } from "../../src/lib/core/ledger";
import { profitAndLoss, trialBalance } from "../../src/lib/core/financialReports";

let tenantId: string;
let partyId: string;
let membershipId: string;

const MARCH = new Date("2026-03-10T12:00:00Z");

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Backfill Co", niche: "RETAIL" } });
  tenantId = t.id;
  const p = await prisma.party.create({
    data: { tenantId, name: "A Customer", role: "CUSTOMER" },
  });
  partyId = p.id;
  const u = await prisma.user.create({ data: { email: `bf-${t.id}@test.local`, name: "Owner" } });
  const m = await prisma.membership.create({ data: { tenantId, userId: u.id, role: "OWNER" } });
  membershipId = m.id;
  await ensureChartOfAccounts(tenantId);
});

afterEach(async () => {
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.accountingPeriod.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  await prisma.membership.delete({ where: { id: membershipId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  if (m) await prisma.user.delete({ where: { id: m.userId } });
});

async function invoice(amountCents: number, opts: { taxRatePercent?: number; at?: Date; status?: "SENT" | "PAID" | "DRAFT" | "CANCELLED" } = {}) {
  const item = await prisma.item.create({
    data: { tenantId, name: "Thing", unitPriceCents: amountCents },
  });
  const t = await prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: "INVOICE",
      status: opts.status ?? "SENT",
      amountCents,
      createdAt: opts.at ?? MARCH,
    },
  });
  await prisma.transactionLine.create({
    data: {
      transactionId: t.id,
      itemId: item.id,
      quantity: 1,
      unitPriceCents: amountCents,
      taxRatePercent: opts.taxRatePercent ?? null,
    },
  });
  return t;
}

describe("backfillLedger", () => {
  it("posts an invoice as receivable against income", async () => {
    await invoice(100_000);
    const result = await backfillLedger(tenantId);

    expect(result.invoices).toBe(1);
    expect(result.problems).toEqual([]);

    const tb = await trialBalance(tenantId);
    expect(tb.balanced).toBe(true);

    const receivable = tb.rows.find((r) => r.code === "1100");
    const sales = tb.rows.find((r) => r.code === "4000");
    expect(receivable!.debitBalanceCents).toBe(100_000);
    expect(sales!.creditBalanceCents).toBe(100_000);
  });

  it("splits tax out of a gross invoice rather than adding it on", async () => {
    // R115 gross at 15% is R100 of income and R15 of tax owed — not R115 of
    // income plus R17.25 of tax, which is what adding rather than extracting
    // would produce.
    await invoice(115_000, { taxRatePercent: 15 });
    await backfillLedger(tenantId);

    const tb = await trialBalance(tenantId);
    expect(tb.rows.find((r) => r.code === "4000")!.creditBalanceCents).toBe(100_000);
    expect(tb.rows.find((r) => r.code === "2100")!.creditBalanceCents).toBe(15_000);
    expect(tb.balanced).toBe(true);
  });

  it("is safe to run twice", async () => {
    await invoice(100_000);

    const first = await backfillLedger(tenantId);
    expect(first.invoices).toBe(1);

    const second = await backfillLedger(tenantId);
    expect(second.invoices).toBe(0);
    expect(second.skippedAlreadyPosted).toBe(1);

    // The revenue did not double, which is the whole point.
    const pl = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    expect(pl.income.totalCents).toBe(100_000);
  });

  it("leaves drafts and cancelled invoices out of income", async () => {
    await invoice(100_000, { status: "DRAFT" });
    await invoice(50_000, { status: "CANCELLED" });
    await invoice(20_000, { status: "SENT" });

    const result = await backfillLedger(tenantId);
    expect(result.invoices).toBe(1);

    const pl = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    expect(pl.income.totalCents).toBe(20_000);
  });

  it("refuses to post into a month already reported on", async () => {
    await invoice(100_000, { at: MARCH });
    await closePeriod({ tenantId, year: 2026, month: 3 });

    const result = await backfillLedger(tenantId);
    expect(result.invoices).toBe(0);
    expect(result.skippedClosedPeriod).toBe(1);
    // Silently changing a closed month is worse than not backfilling it.
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);
  });

  it("separates cash at a till from money in the bank", async () => {
    const inv = await invoice(100_000);
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId,
        type: "PAYMENT",
        status: "PAID",
        amountCents: 100_000,
        parentId: inv.id,
        paymentMethod: "cash",
        createdAt: MARCH,
      },
    });

    await backfillLedger(tenantId);
    const tb = await trialBalance(tenantId);

    expect(tb.rows.find((r) => r.code === "1010")!.debitBalanceCents).toBe(100_000);
    expect(tb.rows.find((r) => r.code === "1000")).toBeUndefined();
    // Invoice raised then fully paid leaves nothing owing.
    expect(tb.rows.find((r) => r.code === "1100")).toBeUndefined();
  });

  it("treats a payment with no invoice as a cash sale", async () => {
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId,
        type: "PAYMENT",
        status: "PAID",
        amountCents: 30_000,
        paymentMethod: "card",
        createdAt: MARCH,
      },
    });

    await backfillLedger(tenantId);
    const tb = await trialBalance(tenantId);
    // Straight to income — there was never a receivable to clear.
    expect(tb.rows.find((r) => r.code === "4000")!.creditBalanceCents).toBe(30_000);
    expect(tb.rows.find((r) => r.code === "1100")).toBeUndefined();
  });

  it("books owner drawings against equity, not as a business cost", async () => {
    await prisma.expense.create({
      data: {
        tenantId,
        submittedById: membershipId,
        descriptionText: "Family dinner",
        amountCents: 80_000,
        status: "APPROVED",
        isOwnerDrawing: true,
        createdAt: MARCH,
      },
    });
    await prisma.expense.create({
      data: {
        tenantId,
        submittedById: membershipId,
        descriptionText: "Diesel",
        amountCents: 20_000,
        status: "APPROVED",
        isOwnerDrawing: false,
        createdAt: MARCH,
      },
    });

    await backfillLedger(tenantId);

    const pl = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    // Only the diesel is a cost of trading. The dinner reduced the owner's
    // stake — booking it as an expense is what makes a profitable business
    // look like it makes nothing.
    expect(pl.expenses.totalCents).toBe(20_000);

    const tb = await trialBalance(tenantId);
    expect(tb.rows.find((r) => r.code === "3100")!.debitBalanceCents).toBe(80_000);
    expect(tb.rows.find((r) => r.code === "5300")!.debitBalanceCents).toBe(20_000);
  });

  it("guesses a sensible account from the description", async () => {
    for (const text of [
      "Office rent for March",
      "Telkom internet",
      "Something unguessable",
    ]) {
      await prisma.expense.create({
        data: {
          tenantId,
          submittedById: membershipId,
          descriptionText: text,
          amountCents: 10_000,
          status: "APPROVED",
          isOwnerDrawing: false,
          createdAt: MARCH,
        },
      });
    }

    await backfillLedger(tenantId);
    const tb = await trialBalance(tenantId);
    for (const code of ["5200", "5400", "5900"]) {
      expect(tb.rows.find((r) => r.code === code)!.debitBalanceCents).toBe(10_000);
    }
  });
});

describe("ledgerCoverage", () => {
  it("reports what has not reached the books yet", async () => {
    await invoice(100_000);
    await prisma.expense.create({
      data: {
        tenantId,
        submittedById: membershipId,
        descriptionText: "Something",
        amountCents: 5_000,
        status: "APPROVED",
        createdAt: MARCH,
      },
    });

    const before = await ledgerCoverage(tenantId);
    expect(before.upToDate).toBe(false);
    expect(before.unpostedInvoices).toBe(1);
    expect(before.unpostedExpenses).toBe(1);

    await backfillLedger(tenantId);

    const after = await ledgerCoverage(tenantId);
    expect(after.upToDate).toBe(true);
    expect(after.unpostedInvoices).toBe(0);
    expect(after.postedEntries).toBe(2);
  });
});
