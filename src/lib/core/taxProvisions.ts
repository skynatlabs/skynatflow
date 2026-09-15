// Tax that is not yours, and tax that is coming.
//
// VAT set-aside: the tax collected on sales was never the business's money,
// and spending it is the most common way a solvent business dies. This
// compares what has been collected (less what can be claimed back) with what
// is in the bank, and says when the bank could not pay it.
//
// Provisional and payroll tax: estimated from posted figures as the period
// runs, so the provision is raised month by month rather than in a panic at
// the deadline. The rates are workspace settings with defaults; the defaults
// are named on every figure because a wrong rate presented confidently is
// worse than no estimate.

import { prisma } from "@/lib/db";
import { accountBalances, profitAndLoss } from "./financialReports";
import { formatMoney, tenantCurrency } from "./currency";

/** Default rates. Overridable per workspace through a TenantFact "tax:rate:<key>". */
const DEFAULT_INCOME_TAX_RATE = 0.27;
const DEFAULT_PAYROLL_TAX_RATE = 0.18;

async function rate(tenantId: string, key: string, fallback: number): Promise<{ value: number; assumed: boolean }> {
  const fact = await prisma.tenantFact.findFirst({ where: { tenantId, key: `tax:rate:${key}` }, select: { value: true } });
  const v = fact ? Number(fact.value) : NaN;
  return Number.isFinite(v) && v > 0 && v < 1 ? { value: v, assumed: false } : { value: fallback, assumed: true };
}

export interface VatSetAside {
  vatOwedCents: number;
  cashCents: number;
  coveredPercent: number | null;
  shortfallCents: number;
  summary: string;
}

export async function vatSetAside(tenantId: string, at = new Date()): Promise<VatSetAside> {
  const [balances, currency] = await Promise.all([accountBalances(tenantId, { to: at }), tenantCurrency(tenantId)]);
  const vat = balances.find((b) => b.code === "2100");
  const cash = balances.filter((b) => b.type === "ASSET" && b.subtype === "cash").reduce((s, b) => s + b.balanceCents, 0);
  // A liability's balance reads as a positive amount owed.
  const owed = Math.max(0, vat ? Math.abs(vat.balanceCents) * (vat.balanceCents < 0 ? 1 : 1) : 0);
  const money = (c: number) => formatMoney(c, currency);
  const shortfall = Math.max(0, owed - Math.max(0, cash));
  const covered = owed > 0 ? Math.min(100, Math.round((Math.max(0, cash) / owed) * 100)) : null;
  const summary =
    owed === 0
      ? "No tax collected is outstanding."
      : shortfall > 0
        ? `${money(owed)} of tax collected on sales is owed, and the bank holds ${money(Math.max(0, cash))}. ${money(shortfall)} of the tax man's money has already been spent.`
        : `${money(owed)} of tax collected is owed and the bank covers it.`;
  return { vatOwedCents: owed, cashCents: cash, coveredPercent: covered, shortfallCents: shortfall, summary };
}

export interface TaxProvision {
  kind: "INCOME" | "PAYROLL";
  basisCents: number;
  ratePercent: number;
  rateAssumed: boolean;
  provisionCents: number;
  from: Date;
  to: Date;
  note: string;
}

export async function taxProvisions(tenantId: string, at = new Date()): Promise<TaxProvision[]> {
  const yearStart = new Date(Date.UTC(at.getUTCFullYear(), 0, 1));
  const [pl, balances, income, payroll, currency] = await Promise.all([
    profitAndLoss(tenantId, { from: yearStart, to: at }),
    accountBalances(tenantId, { from: yearStart, to: at }),
    rate(tenantId, "income", DEFAULT_INCOME_TAX_RATE),
    rate(tenantId, "payroll", DEFAULT_PAYROLL_TAX_RATE),
    tenantCurrency(tenantId),
  ]);
  const money = (c: number) => formatMoney(c, currency);
  const wages = balances.find((b) => b.code === "5100")?.balanceCents ?? 0;
  const out: TaxProvision[] = [];
  const profit = Math.max(0, pl.netProfitCents);
  out.push({
    kind: "INCOME",
    basisCents: profit,
    ratePercent: Math.round(income.value * 100),
    rateAssumed: income.assumed,
    provisionCents: Math.round(profit * income.value),
    from: yearStart, to: at,
    note: profit === 0
      ? "No taxable profit so far this year."
      : `${money(profit)} of profit this year at ${Math.round(income.value * 100)}%${income.assumed ? " (the default rate — set yours with the fact tax:rate:income)" : ""} means ${money(Math.round(profit * income.value))} to have ready.`,
  });
  out.push({
    kind: "PAYROLL",
    basisCents: Math.abs(wages),
    ratePercent: Math.round(payroll.value * 100),
    rateAssumed: payroll.assumed,
    provisionCents: Math.round(Math.abs(wages) * payroll.value),
    from: yearStart, to: at,
    note: wages === 0
      ? "No wages posted this year."
      : `${money(Math.abs(wages))} of wages at ${Math.round(payroll.value * 100)}%${payroll.assumed ? " (default)" : ""} — roughly ${money(Math.round(Math.abs(wages) * payroll.value))} of payroll tax across the year.`,
  });
  return out;
}
