// The general ledger and the three reports.
//
// Most of these tests are about what the ledger REFUSES. An accounting engine
// that posts what it is told is not worth having; the value is entirely in
// the entries it will not write, because those are what make it safe to let
// an agent keep the books.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  closePeriod,
  createAccount,
  deactivateAccount,
  ensureChartOfAccounts,
  PeriodClosedError,
  postEntry,
  reopenPeriod,
  reverseEntry,
  UnbalancedEntryError,
} from "../../src/lib/core/ledger";
import {
  balanceSheet,
  profitAndLoss,
  trialBalance,
} from "../../src/lib/core/financialReports";

let tenantId: string;

const MARCH = new Date("2026-03-15T12:00:00Z");

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Books Co", niche: "SERVICES" } });
  tenantId = t.id;
  await ensureChartOfAccounts(tenantId);
});

afterEach(async () => {
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.accountingPeriod.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

// ------------------------------------------------------- chart of accounts

describe("ensureChartOfAccounts", () => {
  it("gives a new workspace a usable chart", async () => {
    const accounts = await prisma.account.findMany({ where: { tenantId } });
    expect(accounts.length).toBeGreaterThan(20);
    expect(accounts.map((a) => a.code)).toContain("4000");
  });

  it("does not overwrite a name the business changed", async () => {
    const sales = await prisma.account.findFirst({ where: { tenantId, code: "4000" } });
    await prisma.account.update({ where: { id: sales!.id }, data: { name: "Fees" } });

    const result = await ensureChartOfAccounts(tenantId);
    expect(result.created).toBe(0);

    const after = await prisma.account.findFirst({ where: { tenantId, code: "4000" } });
    expect(after!.name).toBe("Fees");
  });

  it("refuses to retire an account the system posts to", async () => {
    const sales = await prisma.account.findFirst({ where: { tenantId, code: "4000" } });
    await expect(deactivateAccount(tenantId, sales!.id)).rejects.toThrow(/system posts to/);
  });

  it("retires an account the business added", async () => {
    const a = await createAccount({ tenantId, code: "5950", name: "Sundries", type: "EXPENSE" });
    await deactivateAccount(tenantId, a.id);
    const after = await prisma.account.findUnique({ where: { id: a.id } });
    expect(after!.isActive).toBe(false);
  });

  it("will not create a duplicate code", async () => {
    await expect(
      createAccount({ tenantId, code: "4000", name: "Another Sales", type: "INCOME" })
    ).rejects.toThrow(/already exists/);
  });
});

// ---------------------------------------------------------------- refusals

describe("what postEntry refuses", () => {
  it("refuses an entry that does not balance", async () => {
    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "1100", debitCents: 10_000 },
          { accountCode: "4000", creditCents: 9_000 },
        ],
      })
    ).rejects.toThrow(UnbalancedEntryError);

    // And nothing was written — a partial write here would produce exactly
    // the unbalanced book this function exists to prevent.
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);
  });

  it("refuses a negative amount rather than treating it as the other side", async () => {
    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "1100", debitCents: -10_000 },
          { accountCode: "4000", creditCents: -10_000 },
        ],
      })
    ).rejects.toThrow(/can't be negative/);
  });

  it("refuses a line that is both a debit and a credit", async () => {
    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "1100", debitCents: 10_000, creditCents: 5_000 },
          { accountCode: "4000", creditCents: 5_000 },
        ],
      })
    ).rejects.toThrow(/either a debit or a credit/);
  });

  it("refuses a one-sided entry", async () => {
    await expect(
      postEntry({ tenantId, entryDate: MARCH, lines: [{ accountCode: "1100", debitCents: 100 }] })
    ).rejects.toThrow(/at least two lines/);
  });

  it("refuses an account that is not in the chart", async () => {
    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "9999", debitCents: 100 },
          { accountCode: "4000", creditCents: 100 },
        ],
      })
    ).rejects.toThrow(/No such account/);
  });

  it("refuses another workspace's account", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Books", niche: "SERVICES" } });
    await ensureChartOfAccounts(other.id);
    const theirs = await prisma.account.findFirst({ where: { tenantId: other.id, code: "4000" } });

    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "1100", debitCents: 100 },
          { accountId: theirs!.id, creditCents: 100 },
        ],
      })
    ).rejects.toThrow(/isn't in your chart/);

    await prisma.account.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

// ----------------------------------------------------------------- periods

describe("a closed month", () => {
  it("refuses a posting into it, whoever is asking", async () => {
    await closePeriod({ tenantId, year: 2026, month: 3 });

    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        lines: [
          { accountCode: "1100", debitCents: 100 },
          { accountCode: "4000", creditCents: 100 },
        ],
      })
    ).rejects.toThrow(PeriodClosedError);

    // The agent has no privileged path around it — same function, same refusal.
    await expect(
      postEntry({
        tenantId,
        entryDate: MARCH,
        byAgent: true,
        lines: [
          { accountCode: "1100", debitCents: 100 },
          { accountCode: "4000", creditCents: 100 },
        ],
      })
    ).rejects.toThrow(PeriodClosedError);
  });

  it("still accepts postings into an open month", async () => {
    await closePeriod({ tenantId, year: 2026, month: 3 });
    const entry = await postEntry({
      tenantId,
      entryDate: new Date("2026-04-02T12:00:00Z"),
      lines: [
        { accountCode: "1100", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    });
    expect(entry.id).toBeTruthy();
  });

  it("can be reopened deliberately", async () => {
    await closePeriod({ tenantId, year: 2026, month: 3 });
    await reopenPeriod(tenantId, 2026, 3);
    const entry = await postEntry({
      tenantId,
      entryDate: MARCH,
      lines: [
        { accountCode: "1100", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    });
    expect(entry.id).toBeTruthy();
  });
});

// --------------------------------------------------------------- reversal

describe("correcting a mistake", () => {
  it("reverses rather than edits, and leaves both visible", async () => {
    const wrong = await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "Invoice 12 — wrong amount",
      lines: [
        { accountCode: "1100", debitCents: 100_000 },
        { accountCode: "4000", creditCents: 100_000 },
      ],
    });

    const reversal = await reverseEntry({
      tenantId,
      entryId: wrong.id,
      on: new Date("2026-04-01T12:00:00Z"),
    });

    // The original is still there. History of what was believed survives.
    const original = await prisma.journalEntry.findUnique({
      where: { id: wrong.id },
      include: { lines: true },
    });
    expect(original).not.toBeNull();
    expect(original!.lines).toHaveLength(2);

    const lines = await prisma.journalLine.findMany({ where: { entryId: reversal.id } });
    const debit = lines.find((l) => l.debitCents > 0)!;
    const credit = lines.find((l) => l.creditCents > 0)!;
    expect(debit.debitCents).toBe(100_000);
    expect(credit.creditCents).toBe(100_000);

    // Net effect on the books is zero.
    const tb = await trialBalance(tenantId);
    expect(tb.rows).toHaveLength(0);
  });

  it("will not reverse the same entry twice", async () => {
    const e = await postEntry({
      tenantId,
      entryDate: MARCH,
      lines: [
        { accountCode: "1100", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    });
    await reverseEntry({ tenantId, entryId: e.id });
    await expect(reverseEntry({ tenantId, entryId: e.id })).rejects.toThrow(/already been reversed/);
  });

  it("will not reverse another workspace's entry", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other R", niche: "SERVICES" } });
    const e = await postEntry({
      tenantId,
      entryDate: MARCH,
      lines: [
        { accountCode: "1100", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    });
    await expect(reverseEntry({ tenantId: other.id, entryId: e.id })).rejects.toThrow(/not found/);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

// ----------------------------------------------------------------- reports

describe("the three reports", () => {
  beforeEach(async () => {
    // A small trading month: R10,000 of sales on credit, R4,000 of stock
    // sold, R1,500 of rent, and R6,000 collected.
    await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "Sales",
      lines: [
        { accountCode: "1100", debitCents: 1_000_000 },
        { accountCode: "4000", creditCents: 1_000_000 },
      ],
    });
    await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "Cost of the goods sold",
      lines: [
        { accountCode: "5000", debitCents: 400_000 },
        { accountCode: "1200", creditCents: 400_000 },
      ],
    });
    await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "Rent",
      lines: [
        { accountCode: "5200", debitCents: 150_000 },
        { accountCode: "1000", creditCents: 150_000 },
      ],
    });
    await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "Customer paid",
      lines: [
        { accountCode: "1000", debitCents: 600_000 },
        { accountCode: "1100", creditCents: 600_000 },
      ],
    });
  });

  it("produces a trial balance that balances", async () => {
    const tb = await trialBalance(tenantId);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
  });

  it("separates gross margin from overheads", async () => {
    const pl = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });

    expect(pl.income.totalCents).toBe(1_000_000);
    expect(pl.costOfSales.totalCents).toBe(400_000);
    expect(pl.grossProfitCents).toBe(600_000);
    expect(pl.grossMarginPercent).toBe(60);
    expect(pl.expenses.totalCents).toBe(150_000);
    expect(pl.netProfitCents).toBe(450_000);
    expect(pl.summary).toContain("kept");
  });

  it("says a loss plainly rather than as a negative profit", async () => {
    await postEntry({
      tenantId,
      entryDate: MARCH,
      memo: "A very expensive mistake",
      lines: [
        { accountCode: "5500", debitCents: 900_000 },
        { accountCode: "1000", creditCents: 900_000 },
      ],
    });

    const pl = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    expect(pl.netProfitCents).toBeLessThan(0);
    expect(pl.summary).toContain("more went out than came in");
  });

  it("balances the balance sheet without needing a year-end close", async () => {
    // The trap: a new business has never closed a year, so profit sits
    // nowhere unless the sheet adds it to equity itself.
    const bs = await balanceSheet(tenantId, new Date("2026-12-31T23:59:59Z"));
    expect(bs.balanced).toBe(true);
    expect(bs.differenceCents).toBe(0);
    expect(bs.retainedThisYearCents).toBe(450_000);
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesCents + bs.totalEquityCents);
  });

  it("reports a period, not everything, when asked for one", async () => {
    await postEntry({
      tenantId,
      entryDate: new Date("2026-07-10T12:00:00Z"),
      memo: "July sales",
      lines: [
        { accountCode: "1100", debitCents: 50_000 },
        { accountCode: "4000", creditCents: 50_000 },
      ],
    });

    const marchOnly = await profitAndLoss(tenantId, {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-03-31T23:59:59Z"),
    });
    expect(marchOnly.income.totalCents).toBe(1_000_000);

    const wholeYear = await profitAndLoss(tenantId, {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T23:59:59Z"),
    });
    expect(wholeYear.income.totalCents).toBe(1_050_000);
  });
});
