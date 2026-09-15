// The three reports that decide whether a business is real.
//
// All three are the same query shaped three ways: sum the journal by account,
// then present it. That they are derived rather than stored is the point — a
// stored balance can drift from the entries that produced it, and then two
// screens disagree and neither is believed again.
//
// Sign convention, stated once because every line below depends on it:
// assets and expenses increase on the debit side, liabilities, equity and
// income increase on the credit side. Every balance here is reported as a
// positive number in the direction that account naturally runs, so nobody
// has to read a minus sign to know whether a month was good.

import { prisma } from "@/lib/db";
import { AccountType } from "@prisma/client";

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  debitCents: number;
  creditCents: number;
  /** Positive in the direction this account naturally runs. */
  balanceCents: number;
}

const DEBIT_NATURED: ReadonlySet<AccountType> = new Set<AccountType>(["ASSET", "EXPENSE"]);

/**
 * Every account's balance over a window.
 *
 * `from` is optional because the answer differs by report: a profit and loss
 * covers a period, a balance sheet covers everything up to a date. Passing no
 * `from` means "since the business began", which is what a balance sheet
 * wants.
 */
export interface BalanceScope {
  from?: Date;
  to?: Date;
  /** Limit to one branch. */
  branchId?: string | null;
  /** Limit to entries carrying no branch at all. Distinct from branchId: null. */
  onlyUnassigned?: boolean;
}

export async function accountBalances(
  tenantId: string,
  opts: BalanceScope = {}
): Promise<AccountBalance[]> {
  const to = opts.to ?? new Date();

  // Three different questions, and conflating them is how a branch report
  // ends up double-counting: everything, one branch, or the entries nobody
  // has assigned yet.
  const branchWhere = opts.onlyUnassigned
    ? { branchId: null }
    : opts.branchId
      ? { branchId: opts.branchId }
      : {};

  const [accounts, sums] = await Promise.all([
    prisma.account.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        entry: {
          tenantId,
          ...branchWhere,
          entryDate: { ...(opts.from ? { gte: opts.from } : {}), lte: to },
        },
      },
      _sum: { debitCents: true, creditCents: true },
    }),
  ]);

  const byAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  return accounts.map((a) => {
    const sum = byAccount.get(a.id);
    const debitCents = sum?.debitCents ?? 0;
    const creditCents = sum?.creditCents ?? 0;
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      debitCents,
      creditCents,
      balanceCents: DEBIT_NATURED.has(a.type)
        ? debitCents - creditCents
        : creditCents - debitCents,
    };
  });
}

// --------------------------------------------------------- trial balance

export interface TrialBalanceRow extends AccountBalance {
  /** The net balance, placed in whichever column it belongs in. */
  debitBalanceCents: number;
  creditBalanceCents: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Should always be true. False means something wrote to the tables directly. */
  balanced: boolean;
  to: Date;
}

/**
 * The accountant's first question: does it add up?
 *
 * postEntry() makes an unbalanced book impossible through the application, so
 * `balanced` being false is not a bookkeeping error — it means somebody wrote
 * to the database behind the app. Reporting it rather than assuming it is the
 * only way anyone would find out.
 */
export async function trialBalance(tenantId: string, to?: Date): Promise<TrialBalance> {
  // Balances, not movements. An account that was debited and credited the
  // same amount — which is exactly what a reversal produces — has no balance
  // and does not belong on a trial balance. Listing its gross activity would
  // fill the report with pairs that cancel, which is how a correction ends up
  // looking like a problem.
  const rows: TrialBalanceRow[] = (await accountBalances(tenantId, { to }))
    .filter((r) => r.balanceCents !== 0)
    .map((r) => {
      // balanceCents is already signed in the account's natural direction, so
      // a negative one means the account is running the other way — an
      // overdrawn bank account is a credit balance, and belongs in that column.
      const naturalDebit = DEBIT_NATURED.has(r.type);
      const runsNaturally = r.balanceCents > 0;
      const onDebitSide = naturalDebit === runsNaturally;
      const magnitude = Math.abs(r.balanceCents);
      return {
        ...r,
        debitBalanceCents: onDebitSide ? magnitude : 0,
        creditBalanceCents: onDebitSide ? 0 : magnitude,
      };
    });

  const totalDebitCents = rows.reduce((s, r) => s + r.debitBalanceCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.creditBalanceCents, 0);

  return {
    rows,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
    to: to ?? new Date(),
  };
}

// ------------------------------------------------------------ profit & loss

export interface ReportSection {
  label: string;
  rows: AccountBalance[];
  totalCents: number;
}

export interface ProfitAndLoss {
  income: ReportSection;
  costOfSales: ReportSection;
  grossProfitCents: number;
  expenses: ReportSection;
  netProfitCents: number;
  /** Gross profit as a percentage of income. Null when there was no income. */
  grossMarginPercent: number | null;
  from: Date;
  to: Date;
  summary: string;
}

/**
 * Did this business make money, over a period.
 *
 * Cost of sales is separated from overheads rather than lumped into one
 * expenses total, because gross margin is the number a trading business
 * actually steers by and it is invisible if the two are mixed.
 */
export async function profitAndLoss(
  tenantId: string,
  opts: BalanceScope = {}
): Promise<ProfitAndLoss> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(Date.UTC(to.getUTCFullYear(), 0, 1));

  const balances = await accountBalances(tenantId, { ...opts, from, to });
  const nonZero = balances.filter((b) => b.balanceCents !== 0);

  const incomeRows = nonZero.filter((b) => b.type === "INCOME");
  const cogsRows = nonZero.filter((b) => b.type === "EXPENSE" && b.subtype === "cogs");
  const expenseRows = nonZero.filter((b) => b.type === "EXPENSE" && b.subtype !== "cogs");

  const total = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.balanceCents, 0);

  const incomeTotal = total(incomeRows);
  const cogsTotal = total(cogsRows);
  const expensesTotal = total(expenseRows);
  const grossProfitCents = incomeTotal - cogsTotal;
  const netProfitCents = grossProfitCents - expensesTotal;

  return {
    income: { label: "Income", rows: incomeRows, totalCents: incomeTotal },
    costOfSales: { label: "Cost of sales", rows: cogsRows, totalCents: cogsTotal },
    grossProfitCents,
    expenses: { label: "Expenses", rows: expenseRows, totalCents: expensesTotal },
    netProfitCents,
    grossMarginPercent:
      incomeTotal > 0 ? Math.round((grossProfitCents / incomeTotal) * 1000) / 10 : null,
    from,
    to,
    summary: plSummary(incomeTotal, netProfitCents),
  };
}

function plSummary(incomeCents: number, netCents: number): string {
  if (incomeCents === 0 && netCents === 0) return "";
  const rands = (c: number) =>
    `R${Math.abs(c / 100).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

  if (netCents > 0) {
    return `${rands(incomeCents)} in, ${rands(netCents)} kept.`;
  }
  if (netCents < 0) {
    // Said plainly. A loss described as "negative net profit" is a loss
    // somebody has to read twice.
    return `${rands(incomeCents)} in, and ${rands(netCents)} more went out than came in.`;
  }
  return `${rands(incomeCents)} in, exactly breaking even.`;
}

// ----------------------------------------------------------- balance sheet

export interface BalanceSheet {
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection;
  /** Profit not yet moved to equity by a year-end close. */
  retainedThisYearCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  /** Assets = liabilities + equity. False means something is wrong upstream. */
  balanced: boolean;
  differenceCents: number;
  to: Date;
}

/**
 * What the business owns and owes, at a moment.
 *
 * Current-year profit is added to equity explicitly rather than waiting for a
 * year-end journal, because otherwise the sheet does not balance for anyone
 * who has not closed a year — which is every new user, and they would
 * reasonably conclude the software is broken.
 */
export async function balanceSheet(tenantId: string, to?: Date): Promise<BalanceSheet> {
  const at = to ?? new Date();
  const balances = await accountBalances(tenantId, { to: at });
  const nonZero = balances.filter((b) => b.balanceCents !== 0);

  const assetRows = nonZero.filter((b) => b.type === "ASSET");
  const liabilityRows = nonZero.filter((b) => b.type === "LIABILITY");
  const equityRows = nonZero.filter((b) => b.type === "EQUITY");

  const total = (rows: AccountBalance[]) => rows.reduce((s, r) => s + r.balanceCents, 0);

  const yearStart = new Date(Date.UTC(at.getUTCFullYear(), 0, 1));
  const thisYear = await profitAndLoss(tenantId, { from: yearStart, to: at });

  const totalAssetsCents = total(assetRows);
  const totalLiabilitiesCents = total(liabilityRows);
  const totalEquityCents = total(equityRows) + thisYear.netProfitCents;

  const differenceCents = totalAssetsCents - (totalLiabilitiesCents + totalEquityCents);

  return {
    assets: { label: "What we own", rows: assetRows, totalCents: totalAssetsCents },
    liabilities: { label: "What we owe", rows: liabilityRows, totalCents: totalLiabilitiesCents },
    equity: { label: "Owner's stake", rows: equityRows, totalCents: totalEquityCents },
    retainedThisYearCents: thisYear.netProfitCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    totalEquityCents,
    balanced: differenceCents === 0,
    differenceCents,
    to: at,
  };
}
