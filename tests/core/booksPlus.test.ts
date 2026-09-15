// The books, completed: cash flow, accruals, depreciation, currency, tax
// provisions and the month-end pack. What matters is that each entry the
// bookkeeper writes is balanced, dated in the right month, and idempotent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { ensureChartOfAccounts, postEntry, SYSTEM_ACCOUNTS } from "../../src/lib/core/ledger";
import { cashFlowStatement } from "../../src/lib/core/cashFlowStatement";
import { accrueExpense, deferRevenue, accrualPosition } from "../../src/lib/core/accruals";
import { runMonthlyDepreciation, bookValues, monthlyCharge } from "../../src/lib/core/depreciation";
import { setDocumentCurrency, baseAmountCents } from "../../src/lib/core/documentCurrency";
import { vatSetAside, taxProvisions } from "../../src/lib/core/taxProvisions";
import { monthEndPack } from "../../src/lib/core/bookkeeper";

let tenantId: string;
const MAR = new Date("2026-03-10T12:00:00Z");

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Books+ Co", niche: "SERVICES" } });
  tenantId = t.id;
  await ensureChartOfAccounts(tenantId);
});

afterEach(async () => {
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.journalLine.deleteMany({ where: { entry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("cash flow statement", () => {
  it("splits cash movements by what the other side was", async () => {
    // A sale paid in cash, a van bought, a loan drawn.
    await postEntry({ tenantId, entryDate: MAR, lines: [{ accountCode: SYSTEM_ACCOUNTS.bank, debitCents: 10_000_00 }, { accountCode: SYSTEM_ACCOUNTS.sales, creditCents: 10_000_00 }] });
    await postEntry({ tenantId, entryDate: MAR, lines: [{ accountCode: "1500", debitCents: 40_000_00 }, { accountCode: SYSTEM_ACCOUNTS.bank, creditCents: 40_000_00 }] });
    await postEntry({ tenantId, entryDate: MAR, lines: [{ accountCode: SYSTEM_ACCOUNTS.bank, debitCents: 50_000_00 }, { accountCode: "2500", creditCents: 50_000_00 }] });
    const cf = await cashFlowStatement(tenantId, { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-31T23:59:59Z") });
    expect(cf.operatingCents).toBe(10_000_00);
    expect(cf.investingCents).toBe(-40_000_00);
    expect(cf.financingCents).toBe(50_000_00);
    expect(cf.netChangeCents).toBe(20_000_00);
    expect(cf.closingCents).toBe(20_000_00);
  });
});

describe("accruals", () => {
  it("books the cost now and reverses it on the first of next month", async () => {
    const { entry, reversal } = await accrueExpense({ tenantId, on: MAR, amountCents: 3_000_00, expenseAccountCode: "5200", memo: "March rent" });
    expect(reversal.entryDate.toISOString().slice(0, 10)).toBe("2026-04-01");
    const linked = await prisma.journalEntry.findUnique({ where: { id: reversal.id } });
    expect(linked!.reversesId).toBe(entry.id);
    const pos = await accrualPosition(tenantId, new Date("2026-03-31T00:00:00Z"));
    expect(pos.accruedExpensesCents).toBe(3_000_00);
    const after = await accrualPosition(tenantId, new Date("2026-04-02T00:00:00Z"));
    expect(after.accruedExpensesCents).toBe(0);
  });

  it("defers income to the month it is earned and refuses a deferral into the past", async () => {
    await deferRevenue({ tenantId, on: MAR, earnedOn: new Date("2026-05-01T12:00:00Z"), amountCents: 5_000_00, memo: "Deposit" });
    const pos = await accrualPosition(tenantId, new Date("2026-04-15T00:00:00Z"));
    expect(pos.deferredIncomeCents).toBe(5_000_00);
    await expect(deferRevenue({ tenantId, on: MAR, earnedOn: new Date("2026-02-01T12:00:00Z"), amountCents: 100, memo: "x" })).rejects.toThrow();
  });
});

describe("depreciation", () => {
  it("charges a twelfth of a year each month, once, and stops at end of life", async () => {
    const van = await prisma.asset.create({ data: { tenantId, name: "Van", purchaseCents: 120_000_00, usefulLifeMonths: 60, purchasedOn: new Date("2026-01-15T00:00:00Z") } });
    const first = await runMonthlyDepreciation(tenantId, 2026, 3);
    expect(first.posted).toBe(1);
    expect(first.totalCents).toBe(2_000_00);
    const again = await runMonthlyDepreciation(tenantId, 2026, 3);
    expect(again.posted).toBe(0);
    expect(again.skipped).toBe(1);
    const [bv] = await bookValues(tenantId);
    expect(bv.assetId).toBe(van.id);
    expect(bv.writtenOffCents).toBe(2_000_00);
    expect(bv.bookValueCents).toBe(118_000_00);
    expect(monthlyCharge({ purchaseCents: 120_000_00, usefulLifeMonths: 60, purchasedOn: new Date("2020-01-01") }, 2026, 3)).toBe(0);
  });
});

describe("multi-currency", () => {
  it("freezes the rate on the document and refuses to change it once paid", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "US Client", role: "CUSTOMER" } });
    const inv = await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "INVOICE", status: "SENT", amountCents: 1_000_00 } });
    const set = await setDocumentCurrency({ tenantId, transactionId: inv.id, currency: "usd", rateToBase: 18.5 });
    expect(set.currency).toBe("USD");
    expect(baseAmountCents(set)).toBe(18_500_00);
    await prisma.transaction.update({ where: { id: inv.id }, data: { status: "PAID" } });
    await expect(setDocumentCurrency({ tenantId, transactionId: inv.id, currency: "USD", rateToBase: 19 })).rejects.toThrow(/paid/);
  });
});

describe("tax", () => {
  it("says when the tax collected has been spent, and estimates provisions with the rate named", async () => {
    await postEntry({ tenantId, entryDate: MAR, lines: [{ accountCode: SYSTEM_ACCOUNTS.bank, debitCents: 11_500_00 }, { accountCode: SYSTEM_ACCOUNTS.sales, creditCents: 10_000_00 }, { accountCode: SYSTEM_ACCOUNTS.salesTax, creditCents: 1_500_00 }] });
    await postEntry({ tenantId, entryDate: MAR, lines: [{ accountCode: "5200", debitCents: 11_000_00 }, { accountCode: SYSTEM_ACCOUNTS.bank, creditCents: 11_000_00 }] });
    const v = await vatSetAside(tenantId, new Date("2026-03-31T00:00:00Z"));
    expect(v.vatOwedCents).toBe(1_500_00);
    expect(v.shortfallCents).toBe(1_000_00);
    const [income] = await taxProvisions(tenantId, new Date("2026-03-31T00:00:00Z"));
    expect(income.rateAssumed).toBe(true);
    expect(income.provisionCents).toBe(0); // rent exceeded sales — no taxable profit
  });
});

describe("the month-end pack", () => {
  it("says what stands between the month and being closed", async () => {
    await prisma.asset.create({ data: { tenantId, name: "Drill", purchaseCents: 6_000_00, usefulLifeMonths: 12, purchasedOn: new Date("2026-01-01T00:00:00Z") } });
    const pack = await monthEndPack(tenantId, 2026, 3);
    expect(pack.depreciation.posted).toBe(1);
    expect(pack.depreciation.totalCents).toBe(500_00);
    expect(pack.readyToClose).toBe(true);
    expect(pack.summary).toContain("Nothing stands in the way");
  });
});
