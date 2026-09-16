// The chief financial officer.
//
// Its job is to know what everything actually costs and to notice money
// leaving that nobody authorised. It is the first officer because it has the
// most machinery already beneath it — books, bank reconciliation, the cash
// forecast, margins, retention, tax — and because its findings are the ones
// most obviously worth money.
//
// Deliberately deterministic, like the compliance watch and for the same
// reasons. "Three invoices worth R84,000 never reached the books" is a fact
// with arithmetic behind it, and routing it through a language model buys
// nothing while costing a call per tenant and the ability to work at all
// when the AI provider is down. A model has a place here — phrasing the
// conversation with a customer, weighing two bad options — but not in
// deciding whether R84,000 is missing.
//
// Every check follows the same shape: find the fact, attach the money, attach
// the evidence somebody can go and check, and write it to the bus. Nothing
// here notifies anybody. The coordinator decides what is worth a person's
// day.

import { prisma } from "@/lib/db";
import { observe, type EvidenceItem, type ObserveParams } from "../observations";
import { ledgerCoverage } from "@/lib/core/ledgerBackfill";
import { listBankAccounts, reconciliationGap } from "@/lib/core/banking";
import { buildCashForecast } from "@/lib/core/cashForecast";
import { findCostRises } from "@/lib/core/repricing";
import { spendSplit } from "@/lib/core/expenses";
import { retentionHeld } from "@/lib/core/progressBilling";
import { profitAndLoss } from "@/lib/core/financialReports";
import { supplierPerformance } from "@/lib/core/supplierPerformance";
import { captureLedger } from "@/lib/core/captureLedger";
import { possibleDuplicates } from "@/lib/core/expenses";
import { vatSetAside } from "@/lib/core/taxProvisions";
import { formatMoney } from "@/lib/format/money";
import { tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;

// Currency in, never assumed: the CFO's sentences are read by the owner.
function money(cents: number, currency: string): string {
  return formatMoney(Math.abs(cents), currency);
}

const dash = (tenantId: string, path: string) => `/dashboard/${tenantId}/${path}`;

// ------------------------------------------------------------------ checks
//
// Each returns a finding or null. Null means genuinely nothing to say, which
// is the common case on a well-run week and has to stay cheap.

/**
 * Work that never reached the books.
 *
 * Every figure the CFO produces is built on the ledger, so this check comes
 * first: a profit figure built on two thirds of the invoices is worse than no
 * figure, because somebody will act on it.
 */
async function booksBehind(tenantId: string, currency: string): Promise<Finding | null> {
  const coverage = await ledgerCoverage(tenantId);
  if (coverage.upToDate) return null;

  const missing =
    coverage.unpostedInvoices + coverage.unpostedPayments + coverage.unpostedExpenses;
  if (missing === 0) return null;

  const evidence: EvidenceItem[] = [
    { label: "Invoices not posted", value: String(coverage.unpostedInvoices) },
    { label: "Payments not posted", value: String(coverage.unpostedPayments) },
    { label: "Expenses not posted", value: String(coverage.unpostedExpenses) },
  ];

  return {
    headline: `${missing} thing${missing === 1 ? "" : "s"} never reached the books, so every figure I produce is missing them.`,
    detail:
      "Until these are posted the profit and loss, the balance sheet and the margin figures are all understated.",
    // What the unposted invoices are worth — the money the reports are blind
    // to. Only those: the ones already in the books are not missing.
    moneyCents: coverage.unpostedInvoiceCents || null,
    confidence: 100,
    dedupeKey: "cfo:books-behind",
    evidence,
    proposedAction: "Post the outstanding history to the books — it takes one click and nothing is overwritten.",
  };
}

/** Statement lines nobody has explained. */
async function bankUnexplained(tenantId: string, currency: string): Promise<Finding | null> {
  const accounts = await listBankAccounts(tenantId);
  if (accounts.length === 0) return null;

  let unmatched = 0;
  let unexplainedCents = 0;
  for (const a of accounts) {
    const gap = await reconciliationGap(tenantId, a.id);
    unmatched += gap.unmatched;
    unexplainedCents += Math.abs(gap.unexplainedCents);
  }
  if (unmatched === 0) return null;

  return {
    headline: `${unmatched} bank line${unmatched === 1 ? "" : "s"} worth ${money(unexplainedCents, currency)} ${unmatched === 1 ? "is" : "are"} still unexplained.`,
    detail:
      "Money has moved through the account that the books cannot account for. Some of it is probably income nobody invoiced.",
    moneyCents: unexplainedCents,
    confidence: 100,
    dedupeKey: "cfo:bank-unexplained",
    evidence: [{ label: "Lines", value: String(unmatched), href: dash(tenantId, "banking") }],
    proposedAction: "Work through the matches — most will already have a suggestion waiting.",
  };
}

/**
 * The week the money runs out.
 *
 * The single most useful thing a CFO can say to a small business, and almost
 * none of them can say it.
 */
async function cashGap(tenantId: string, currency: string): Promise<Finding | null> {
  const forecast = await buildCashForecast({ tenantId });
  if (forecast.shortfallWeek === null) return null;

  const week = forecast.weeks[forecast.shortfallWeek];
  if (!week) return null;

  return {
    headline: `On current commitments the account goes negative in week ${forecast.shortfallWeek + 1}, around ${week.weekStart}.`,
    detail:
      `The lowest point is ${money(forecast.lowestCents, currency)}. ` +
      forecast.caveats.join(" "),
    moneyCents: Math.abs(forecast.lowestCents),
    confidence: 75, // a forecast, and it says so
    urgentBy: new Date(week.weekStart),
    dedupeKey: "cfo:cash-shortfall",
    evidence: [
      { label: "Opening balance", value: money(forecast.openingCents, currency) },
      { label: "Lowest point", value: money(forecast.lowestCents, currency) },
      { label: "Week", value: week.weekStart, href: dash(tenantId, "cash-forecast") },
    ],
    proposedAction:
      "Chasing the right invoice moves this more than chasing the oldest. I can rank them by effect on that week.",
  };
}

/** Selling below cost, or at a margin nobody chose. */
async function marginErosion(tenantId: string, currency: string): Promise<Finding | null> {
  const report = await findCostRises(tenantId);
  if (report.lines.length === 0) return null;

  const losses = report.lines.filter((l) => l.sellingAtALoss);
  const worst = report.lines[0];

  // What the erosion is worth is unknowable without volume, so the money
  // attached is the per-unit gap on the worst line rather than an invented
  // annual figure. Overstating it would be the easiest thing in the world
  // and would make every other number here suspect.
  const perUnitGap = worst.latestPaidCents - worst.catalogueCostCents;

  return {
    headline:
      losses.length > 0
        ? `${losses[0].name} now costs more than it sells for — every one sold loses money.`
        : `${report.lines.length} product${report.lines.length === 1 ? "" : "s"} cost more than the catalogue says, so the margin being reported is not the margin being earned.`,
    detail: worst.basis,
    moneyCents: perUnitGap > 0 ? perUnitGap : null,
    confidence: 90,
    dedupeKey: "cfo:margin-erosion",
    evidence: [
      { label: "Worst", value: worst.name, href: dash(tenantId, "margins") },
      { label: "Reported margin", value: `${worst.marginAssumedPercent}%` },
      { label: "Actual margin", value: `${worst.marginNowPercent}%` },
    ],
    proposedAction: `Reprice to ${money(worst.suggestedPriceCents, currency)} to hold the margin this was originally set at.`,
  };
}

/** Spend nobody has split between the business and the owner. */
async function unclassifiedSpend(tenantId: string, currency: string): Promise<Finding | null> {
  const split = await spendSplit(tenantId);
  if (split.unreviewedCount === 0) return null;

  // Only worth raising once it is material enough to distort the picture.
  // Two unreviewed receipts is not a finding, it is a Tuesday.
  if (split.unreviewedCents < 200_000 && split.unreviewedCount < 10) return null;

  return {
    headline: `${money(split.unreviewedCents, currency)} of spending has not been split between the business and you.`,
    detail:
      "Until it is, the cost of running this business is overstated or understated and I cannot tell you which. " +
      "Drawings counted as costs are the most common reason a profitable business appears to make nothing.",
    moneyCents: split.unreviewedCents,
    confidence: 100,
    dedupeKey: "cfo:unclassified-spend",
    evidence: [
      { label: "Payments", value: String(split.unreviewedCount), href: dash(tenantId, "expenses") },
      { label: "Business costs so far", value: money(split.businessCents, currency) },
      { label: "Your drawings so far", value: money(split.drawingsCents, currency) },
    ],
    proposedAction: "Split them — I can classify the obvious ones and ask only about the rest.",
  };
}

/** Money other people are holding. */
async function retentionOutstanding(tenantId: string, currency: string): Promise<Finding | null> {
  const held = await retentionHeld(tenantId);
  if (held.onCompleteJobsCents === 0) return null;

  return {
    headline: `${money(held.onCompleteJobsCents, currency)} of retention is owed on jobs that are already finished.`,
    detail:
      "Retention is collected by asking. Nobody will remind you, and it is usually forgotten once the site is done.",
    moneyCents: held.onCompleteJobsCents,
    confidence: 95,
    dedupeKey: "cfo:retention-outstanding",
    evidence: [{ label: "Jobs", value: String(held.agreements) }],
    proposedAction: "Invoice the retention on the finished jobs.",
  };
}

/** Customers who have stopped paying. */
async function overdueDebtors(tenantId: string, currency: string): Promise<Finding | null> {
  const now = new Date();
  const overdue = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: "INVOICE",
      status: { in: ["SENT", "OVERDUE", "PARTIALLY_PAID"] },
      dueAt: { lt: now },
    },
    select: { id: true, amountCents: true, dueAt: true, party: { select: { name: true } } },
    orderBy: { amountCents: "desc" },
    take: 100,
  });
  if (overdue.length === 0) return null;

  const total = overdue.reduce((s, o) => s + o.amountCents, 0);
  const worst = overdue[0];
  const days = worst.dueAt
    ? Math.floor((now.getTime() - worst.dueAt.getTime()) / 86_400_000)
    : 0;

  return {
    headline: `${money(total, currency)} is overdue across ${overdue.length} invoice${overdue.length === 1 ? "" : "s"}, the largest being ${worst.party.name}.`,
    detail: `${worst.party.name} is ${days} day${days === 1 ? "" : "s"} past due on ${money(worst.amountCents, currency)}.`,
    moneyCents: total,
    confidence: 100,
    dedupeKey: "cfo:overdue-debtors",
    evidence: [
      { label: "Invoices", value: String(overdue.length), href: dash(tenantId, "overdue") },
      { label: "Oldest", value: `${days} days` },
    ],
    proposedAction: "I can draft the chasers, in a tone matched to each customer's payment history.",
  };
}

/** A period that lost money. */
async function tradingAtALoss(tenantId: string, currency: string): Promise<Finding | null> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const pl = await profitAndLoss(tenantId, { from, to: now });

  // Nothing posted means nothing to conclude, not a loss.
  if (pl.income.totalCents === 0 && pl.expenses.totalCents === 0) return null;
  if (pl.netProfitCents >= 0) return null;

  return {
    headline: `The last three months lost ${money(pl.netProfitCents, currency)} — more went out than came in.`,
    detail:
      `${money(pl.income.totalCents, currency)} of income against ${money(pl.costOfSales.totalCents + pl.expenses.totalCents, currency)} of cost.` +
      (pl.grossMarginPercent !== null ? ` Gross margin was ${pl.grossMarginPercent}%.` : ""),
    moneyCents: Math.abs(pl.netProfitCents),
    confidence: 95,
    dedupeKey: "cfo:trading-loss",
    evidence: [
      { label: "Income", value: money(pl.income.totalCents, currency), href: dash(tenantId, "books") },
      { label: "Overheads", value: money(pl.expenses.totalCents, currency) },
      {
        label: "Biggest cost",
        value:
          [...pl.expenses.rows].sort((a, b) => b.balanceCents - a.balanceCents)[0]?.name ?? "—",
      },
    ],
    proposedAction: "Worth looking at together — the largest overhead is usually the one worth attacking first.",
  };
}

/** Suppliers whose prices have crept. */
async function supplierDrift(tenantId: string, currency: string): Promise<Finding | null> {
  const report = await supplierPerformance(tenantId);
  const drifting = report.suppliers.filter(
    (s) => s.priceDriftPercent !== null && s.priceDriftPercent >= 8
  );
  if (drifting.length === 0) return null;

  const worst = drifting.sort((a, b) => b.totalSpentCents - a.totalSpentCents)[0];
  // What the drift has cost, approximately, on what has been spent with them.
  const cost = Math.round(
    worst.totalSpentCents * ((worst.priceDriftPercent ?? 0) / 100)
  );

  return {
    headline: `${worst.name} has raised prices ${worst.priceDriftPercent}% since you started buying from them.`,
    detail:
      "Each rise was small enough to go unquestioned. The cumulative one is not, and it is rarely renegotiated because nobody notices it happening.",
    moneyCents: cost,
    confidence: 80,
    dedupeKey: `cfo:supplier-drift:${worst.supplierId}`,
    subjectType: "customer",
    subjectId: worst.supplierId,
    evidence: [
      { label: "Spent with them", value: money(worst.totalSpentCents, currency), href: dash(tenantId, "margins") },
      { label: "Orders", value: String(worst.ordersPlaced) },
    ],
    proposedAction: "Worth a conversation, or a second quote from somebody else.",
  };
}

// -------------------------------------------------------------------- run

export interface CfoRun {
  checked: number;
  observed: number;
  /** Checks that threw. One broken check must not silence the others. */
  failed: string[];
}

/**
 * Phase 184: how much of what left the bank is actually recorded.
 *
 * Every figure the CFO quotes is built on recorded costs, so the first thing
 * to say about them is what fraction of the costs that is. A cost figure on
 * two thirds of the costs is confidently wrong, and this is the check that
 * says so before anything else does.
 */
async function captureGap(tenantId: string, currency: string): Promise<Finding | null> {
  const ledger = await captureLedger(tenantId);
  if (!ledger.hasBankFeed || ledger.coveragePercent === null) return null;
  if (ledger.coveragePercent >= 85 || ledger.unexplainedCents < 2_000_00) return null;
  return {
    headline: `${money(ledger.unexplainedCents, currency)} left the bank last month that nobody recorded — only ${ledger.coveragePercent}% of spending is in the books.`,
    detail:
      `${ledger.unexplainedCount} bank lines going out match no expense, slip or bill. Every margin and cost-per-kilometre figure I give you is built on the ${ledger.coveragePercent}% that is recorded, so treat them as floors, not facts, until this closes.`,
    dedupeKey: "cfo:capture-gap",
    moneyCents: ledger.unexplainedCents,
    confidence: 95,
    urgentBy: null,
    evidence: [
      { label: "Recorded", value: money(ledger.recordedCents, currency) },
      { label: "Unexplained", value: `${money(ledger.unexplainedCents, currency)} across ${ledger.unexplainedCount} lines` },
      ...ledger.gaps.slice(0, 3).map((g) => ({ label: "Gap", value: g.label })),
    ],
    proposedAction:
      "Work through the unmatched bank lines on the banking page — most are a slip somebody still has. Then have staff photograph slips at the till; it takes less time than the reconciliation does.",
  };
}

/** Phase 177: the same spend, arrived twice, waiting for someone to say so. */
async function duplicateSpend(tenantId: string, currency: string): Promise<Finding | null> {
  const pairs = await possibleDuplicates(tenantId, 10);
  if (pairs.length === 0) return null;
  const total = pairs.reduce((s, p) => s + p.expense.amountCents, 0);
  if (total < 500_00) return null;
  const top = pairs[0];
  return {
    headline: `${pairs.length} cost${pairs.length === 1 ? "" : "s"} worth ${money(total, currency)} look like second copies of something already recorded.`,
    detail: `Same supplier, same amount, same day — the shape a slip takes when it is photographed and then arrives again on the statement. ${top.expense.descriptionText} (${money(top.expense.amountCents, currency)}) is the largest. Counting them twice overstates costs by ${money(total, currency)}.`,
    dedupeKey: `cfo:duplicate:${top.expense.id}`,
    subjectType: "expense",
    subjectId: top.expense.id,
    moneyCents: total,
    confidence: 70,
    urgentBy: null,
    evidence: pairs.slice(0, 4).map((p) => ({
      label: p.expense.descriptionText,
      value: `${money(p.expense.amountCents, currency)} on ${p.expense.spentOn.toISOString().slice(0, 10)}${p.lookalike ? `, like ${p.lookalike.descriptionText}` : ""}`,
    })),
    proposedAction: "Confirm each pair on the expenses page — one click marks the copy, one click keeps both.",
  };
}

/** Phase 123: money collected that was never the business's, already spent. */
async function vatSpent(tenantId: string, currency: string): Promise<Finding | null> {
  const v = await vatSetAside(tenantId);
  if (v.shortfallCents < 1_000_00) return null;
  return {
    headline: `${money(v.shortfallCents, currency)} of the tax collected on sales has already been spent.`,
    detail: v.summary + " When the return falls due, that money has to come from somewhere else.",
    dedupeKey: "cfo:vat-spent",
    moneyCents: v.shortfallCents,
    confidence: 85,
    urgentBy: null,
    evidence: [{ label: "Tax owed", value: money(v.vatOwedCents, currency) }, { label: "In the bank", value: money(Math.max(0, v.cashCents), currency) }],
    proposedAction: "Move the tax collected into a separate account as invoices are paid, so it is never available to spend.",
  };
}

const CHECKS: Array<{ name: string; run: (t: string, currency: string) => Promise<Finding | null> }> = [
  { name: "vatSpent", run: vatSpent },
  { name: "booksBehind", run: booksBehind },
  { name: "bankUnexplained", run: bankUnexplained },
  { name: "cashGap", run: cashGap },
  { name: "overdueDebtors", run: overdueDebtors },
  { name: "tradingAtALoss", run: tradingAtALoss },
  { name: "marginErosion", run: marginErosion },
  { name: "retentionOutstanding", run: retentionOutstanding },
  { name: "unclassifiedSpend", run: unclassifiedSpend },
  { name: "supplierDrift", run: supplierDrift },
  { name: "captureGap", run: captureGap },
  { name: "duplicateSpend", run: duplicateSpend },
];

/**
 * Run the CFO over a workspace.
 *
 * Writes findings to the bus and returns what it did. Raises nothing itself —
 * the coordinator decides, and that separation is what stops nine checks
 * becoming nine interruptions.
 *
 * A check that throws is recorded and skipped. One broken query must not cost
 * a business the other eight findings, and a silent partial run would be
 * worse than either.
 */
export async function runCFO(tenantId: string): Promise<CfoRun> {
  const currency = await tenantCurrency(tenantId);
  const failed: string[] = [];
  let observed = 0;

  for (const check of CHECKS) {
    try {
      const finding = await check.run(tenantId, currency);
      if (!finding) continue;
      const written = await observe({ ...finding, tenantId, officer: "CFO" });
      if (written) observed++;
    } catch (err) {
      failed.push(check.name);
      console.error(`[cfo] ${tenantId} ${check.name} failed:`, err);
    }
  }

  return { checked: CHECKS.length, observed, failed };
}
