// The bookkeeper — the books arc's payoff.
//
// Codes what arrived, proposes the reconciliation, runs the month's
// depreciation, raises the tax provisions, and hands over a month-end pack
// to approve. Nothing here posts money that a person has not seen: the
// backfill posts documents that already exist, the depreciation is
// arithmetic on the register, and the reconciliation is proposals only.
// Closing the month stays a human click.

import { prisma } from "@/lib/db";
import { backfillLedger, ledgerCoverage } from "./ledgerBackfill";
import { runMonthlyDepreciation } from "./depreciation";
import { proposeMatches } from "./reconciliation";
import { listBankAccounts } from "./banking";
import { profitAndLoss, balanceSheet } from "./financialReports";
import { cashFlowStatement } from "./cashFlowStatement";
import { taxProvisions, vatSetAside } from "./taxProvisions";
import { accrualPosition } from "./accruals";
import { possibleDuplicates, unclassifiedExpenses } from "./expenses";
import { formatMoney, tenantCurrency } from "./currency";

export interface MonthEndPack {
  year: number;
  month: number;
  posted: { invoices: number; payments: number; expenses: number };
  depreciation: { posted: number; totalCents: number };
  reconciliation: { proposed: number; unmatched: number };
  toDecide: { unsplitExpenses: number; possibleDuplicates: number };
  netProfitCents: number;
  cashChangeCents: number;
  vat: { owedCents: number; shortfallCents: number };
  provisions: Array<{ kind: string; cents: number; assumed: boolean }>;
  accrued: { accruedExpensesCents: number; deferredIncomeCents: number };
  readyToClose: boolean;
  blockers: string[];
  summary: string;
  generatedAt: Date;
}

/**
 * The month-end pack. With `post`, the bookkeeper does the month's work first
 * — posts outstanding documents and charges depreciation, both idempotent.
 * Without it, it only reads and reports, so looking at a month never writes
 * to the books.
 */
export async function monthEndPack(
  tenantId: string,
  year: number,
  month: number,
  opts: { post?: boolean } = {}
): Promise<MonthEndPack> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);

  const backfill = opts.post
    ? await backfillLedger(tenantId, { from })
    : { invoices: 0, payments: 0, expenses: 0 };
  const dep = opts.post
    ? await runMonthlyDepreciation(tenantId, year, month)
    : { posted: 0, totalCents: 0 };

  let proposed = 0;
  let unmatched = 0;
  for (const bank of await listBankAccounts(tenantId)) {
    try {
      const p = await proposeMatches(tenantId, { bankAccountId: bank.id });
      proposed += p.proposals.length;
      unmatched += p.unexplained;
    } catch {
      /* a bank account with no lines proposes nothing */
    }
  }

  const [pl, cf, vat, provisions, accrued, unsplit, dups, coverage] = await Promise.all([
    profitAndLoss(tenantId, { from, to }),
    cashFlowStatement(tenantId, { from, to }),
    vatSetAside(tenantId, to),
    taxProvisions(tenantId, to),
    accrualPosition(tenantId, to),
    unclassifiedExpenses(tenantId, 100),
    possibleDuplicates(tenantId, 100),
    ledgerCoverage(tenantId),
  ]);
  void balanceSheet;

  const blockers: string[] = [];
  if (!coverage.upToDate) blockers.push("Some documents have not reached the books.");
  if (unsplit.length > 0) blockers.push(`${unsplit.length} payment${unsplit.length === 1 ? "" : "s"} not split business/personal.`);
  if (dups.length > 0) blockers.push(`${dups.length} possible duplicate cost${dups.length === 1 ? "" : "s"} undecided.`);
  if (unmatched > 0) blockers.push(`${unmatched} bank line${unmatched === 1 ? "" : "s"} unmatched.`);

  const summary =
    `${money(pl.netProfitCents)} ${pl.netProfitCents >= 0 ? "profit" : "loss"} for the month; cash ${cf.netChangeCents >= 0 ? "up" : "down"} ${money(Math.abs(cf.netChangeCents))}. ` +
    (opts.post
      ? `${backfill.invoices + backfill.payments + backfill.expenses} document${backfill.invoices + backfill.payments + backfill.expenses === 1 ? "" : "s"} posted, ${dep.posted} depreciation charge${dep.posted === 1 ? "" : "s"} (${money(dep.totalCents)}), `
      : "") +
    `${proposed} bank match${proposed === 1 ? "" : "es"} proposed. ` +
    (blockers.length === 0 ? "Nothing stands in the way of closing." : `Before closing: ${blockers.join(" ")}`);

  return {
    year, month,
    posted: { invoices: backfill.invoices, payments: backfill.payments, expenses: backfill.expenses },
    depreciation: { posted: dep.posted, totalCents: dep.totalCents },
    reconciliation: { proposed, unmatched },
    toDecide: { unsplitExpenses: unsplit.length, possibleDuplicates: dups.length },
    netProfitCents: pl.netProfitCents,
    cashChangeCents: cf.netChangeCents,
    vat: { owedCents: vat.vatOwedCents, shortfallCents: vat.shortfallCents },
    provisions: provisions.map((p) => ({ kind: p.kind, cents: p.provisionCents, assumed: p.rateAssumed })),
    accrued,
    readyToClose: blockers.length === 0,
    blockers,
    summary,
    generatedAt: new Date(),
  };
}

/** The most recent month that is over and not yet closed. */
export async function nextMonthToClose(tenantId: string, now = new Date()): Promise<{ year: number; month: number } | null> {
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const year = lastMonthEnd.getUTCFullYear();
  const month = lastMonthEnd.getUTCMonth() + 1;
  const closed = await prisma.accountingPeriod.findFirst({ where: { tenantId, year, month } });
  return closed ? null : { year, month };
}
