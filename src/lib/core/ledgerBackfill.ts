// Posting the history the business already has into the books.
//
// An accounting engine that starts empty is an accounting engine nobody uses.
// The invoices, payments and expenses are already here — they have been the
// whole product until now — so the books should open with them in, and the
// first profit and loss anyone sees should be about their actual business
// rather than a blank page inviting them to type three years of history.
//
// Two rules make this safe to run repeatedly:
//
//   Every entry carries sourceType and sourceId, and anything already posted
//   is skipped. Running it twice does not double the revenue.
//
//   Anything that falls in a closed month is skipped rather than forced.
//   Backfilling into a month somebody has already reported on would silently
//   change a number they have given to a bank.

import { prisma } from "@/lib/db";
import { JournalSource, TransactionType } from "@prisma/client";
import { ensureChartOfAccounts, isPeriodClosed, postEntry, SYSTEM_ACCOUNTS } from "./ledger";

export interface BackfillResult {
  invoices: number;
  payments: number;
  refunds: number;
  expenses: number;
  skippedAlreadyPosted: number;
  skippedClosedPeriod: number;
  /** Anything that could not be posted, with the reason. Reported, never swallowed. */
  problems: string[];
}

/**
 * Expense categories are free text, so mapping them to accounts is a guess.
 *
 * A wrong-but-sensible account the owner can recode beats dropping the
 * expense, and beats inventing an account per category string — which would
 * turn a chart of twenty-six accounts into one of four hundred within a year.
 */
const CATEGORY_TO_ACCOUNT: Array<{ match: RegExp; code: string }> = [
  { match: /fuel|petrol|diesel|vehicle|car|transport|travel/i, code: "5300" },
  { match: /rent|lease|premises/i, code: "5200" },
  { match: /wage|salary|staff|payroll|labour|labor/i, code: "5100" },
  { match: /phone|internet|data|electric|water|utility|utilities/i, code: "5400" },
  { match: /account|legal|audit|consult|professional/i, code: "5500" },
  { match: /market|advert|promo/i, code: "5600" },
  { match: /insur/i, code: "5700" },
  { match: /bank|fee|charge/i, code: "5800" },
  { match: /stock|material|goods|supplier|inventory/i, code: "5000" },
];

function accountForCategory(category: string | null, description: string): string {
  const haystack = `${category ?? ""} ${description}`;
  for (const rule of CATEGORY_TO_ACCOUNT) {
    if (rule.match.test(haystack)) return rule.code;
  }
  return SYSTEM_ACCOUNTS.otherExpense;
}

/** Split a gross amount into net and tax, given the rate that applied. */
function splitTax(grossCents: number, taxRatePercent: number | null): { net: number; tax: number } {
  if (!taxRatePercent || taxRatePercent <= 0) return { net: grossCents, tax: 0 };
  // Line totals are stored gross, so the tax is extracted rather than added.
  const net = Math.round(grossCents / (1 + taxRatePercent / 100));
  return { net, tax: grossCents - net };
}

async function alreadyPosted(tenantId: string, sourceType: string, sourceId: string) {
  const found = await prisma.journalEntry.findFirst({
    where: { tenantId, sourceType, sourceId },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Post everything this business has done into the journal.
 *
 * Deliberately sequential rather than parallel: postEntry checks period locks
 * and account ownership per call, and a hundred concurrent transactions
 * against the same rows buys nothing on a dataset this size while making a
 * partial failure much harder to reason about.
 */
export async function backfillLedger(
  tenantId: string,
  opts: { from?: Date } = {}
): Promise<BackfillResult> {
  await ensureChartOfAccounts(tenantId);

  const result: BackfillResult = {
    invoices: 0,
    payments: 0,
    refunds: 0,
    expenses: 0,
    skippedAlreadyPosted: 0,
    skippedClosedPeriod: 0,
    problems: [],
  };

  const dateFilter = opts.from ? { gte: opts.from } : undefined;

  // ---- invoices: the customer owes us, and we have earned income ----------
  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.INVOICE,
      // A cancelled invoice was never income. A draft has not been issued.
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    select: {
      id: true,
      amountCents: true,
      createdAt: true,
      itemLines: { select: { quantity: true, unitPriceCents: true, taxRatePercent: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const inv of invoices) {
    if (await alreadyPosted(tenantId, "invoice", inv.id)) {
      result.skippedAlreadyPosted++;
      continue;
    }
    if (await isPeriodClosed(tenantId, inv.createdAt)) {
      result.skippedClosedPeriod++;
      continue;
    }

    // Tax is summed from the lines rather than taken off the header, because
    // a mixed-rate invoice — some items taxed, some not — is common and the
    // header carries no rate at all.
    let taxCents = 0;
    for (const line of inv.itemLines) {
      const gross = line.quantity * line.unitPriceCents;
      taxCents += splitTax(gross, line.taxRatePercent).tax;
    }
    const netCents = inv.amountCents - taxCents;

    if (inv.amountCents <= 0) {
      result.problems.push(`Invoice ${inv.id} has no value — skipped.`);
      continue;
    }

    try {
      await postEntry({
        tenantId,
        entryDate: inv.createdAt,
        memo: "Invoice raised",
        source: JournalSource.INVOICE,
        sourceType: "invoice",
        sourceId: inv.id,
        lines: [
          { accountCode: SYSTEM_ACCOUNTS.receivable, debitCents: inv.amountCents },
          { accountCode: SYSTEM_ACCOUNTS.sales, creditCents: netCents },
          ...(taxCents > 0
            ? [{ accountCode: SYSTEM_ACCOUNTS.salesTax, creditCents: taxCents }]
            : []),
        ],
      });
      result.invoices++;
    } catch (err) {
      result.problems.push(
        `Invoice ${inv.id}: ${err instanceof Error ? err.message : "could not be posted"}`
      );
    }
  }

  // ---- payments: money arrives, the debt shrinks --------------------------
  const payments = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.PAYMENT,
      status: { not: "CANCELLED" },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    select: { id: true, amountCents: true, createdAt: true, paymentMethod: true, parentId: true },
    orderBy: { createdAt: "asc" },
  });

  for (const pay of payments) {
    if (await alreadyPosted(tenantId, "payment", pay.id)) {
      result.skippedAlreadyPosted++;
      continue;
    }
    if (await isPeriodClosed(tenantId, pay.createdAt)) {
      result.skippedClosedPeriod++;
      continue;
    }
    if (pay.amountCents <= 0) continue;

    // Cash at a till is genuinely a different asset from money in the bank,
    // and conflating them is what makes a cash business unable to reconcile.
    const cashLike = pay.paymentMethod === "cash";
    const debitAccount = cashLike ? SYSTEM_ACCOUNTS.cash : SYSTEM_ACCOUNTS.bank;

    // A payment with no parent invoice is a cash sale: there was never a
    // receivable, so the credit goes straight to income.
    const creditAccount = pay.parentId ? SYSTEM_ACCOUNTS.receivable : SYSTEM_ACCOUNTS.sales;

    try {
      await postEntry({
        tenantId,
        entryDate: pay.createdAt,
        memo: pay.parentId ? "Payment received" : "Cash sale",
        source: JournalSource.PAYMENT,
        sourceType: "payment",
        sourceId: pay.id,
        lines: [
          { accountCode: debitAccount, debitCents: pay.amountCents },
          { accountCode: creditAccount, creditCents: pay.amountCents },
        ],
      });
      result.payments++;
    } catch (err) {
      result.problems.push(
        `Payment ${pay.id}: ${err instanceof Error ? err.message : "could not be posted"}`
      );
    }
  }

  // ---- refunds: money goes back out --------------------------------------
  const refunds = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.REFUND,
      status: { not: "CANCELLED" },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    select: { id: true, amountCents: true, createdAt: true, paymentMethod: true },
    orderBy: { createdAt: "asc" },
  });

  for (const ref of refunds) {
    if (await alreadyPosted(tenantId, "refund", ref.id)) {
      result.skippedAlreadyPosted++;
      continue;
    }
    if (await isPeriodClosed(tenantId, ref.createdAt)) {
      result.skippedClosedPeriod++;
      continue;
    }
    const amount = Math.abs(ref.amountCents);
    if (amount === 0) continue;

    try {
      await postEntry({
        tenantId,
        entryDate: ref.createdAt,
        memo: "Refund issued",
        source: JournalSource.REFUND,
        sourceType: "refund",
        sourceId: ref.id,
        lines: [
          { accountCode: SYSTEM_ACCOUNTS.sales, debitCents: amount },
          {
            accountCode: ref.paymentMethod === "cash" ? SYSTEM_ACCOUNTS.cash : SYSTEM_ACCOUNTS.bank,
            creditCents: amount,
          },
        ],
      });
      result.refunds++;
    } catch (err) {
      result.problems.push(
        `Refund ${ref.id}: ${err instanceof Error ? err.message : "could not be posted"}`
      );
    }
  }

  // ---- expenses: money spent, or taken -----------------------------------
  const expenses = await prisma.expense.findMany({
    where: {
      tenantId,
      // A rejected expense was never paid, and a duplicate was paid once and
      // is already here under its first arrival. Neither touches the books.
      status: { notIn: ["REJECTED", "DUPLICATE"] },
      ...(dateFilter ? { spentOn: dateFilter } : {}),
    },
    orderBy: { spentOn: "asc" },
  });

  for (const exp of expenses) {
    if (await alreadyPosted(tenantId, "expense", exp.id)) {
      result.skippedAlreadyPosted++;
      continue;
    }
    // The day the money left, not the day the slip was typed in. A January
    // fuel bill photographed in March belongs in January.
    if (await isPeriodClosed(tenantId, exp.spentOn)) {
      result.skippedClosedPeriod++;
      continue;
    }
    if (exp.amountCents <= 0) continue;

    // Money the owner took out is not a cost of trading — it reduces their
    // stake. Booking drawings as an expense is the single most common reason
    // a profitable business appears to make nothing, and this is the one
    // place the distinction can actually be enforced.
    //
    // Otherwise: the account somebody coded it to, if anybody did, and a
    // guess from the words on it if not.
    const debitLine = exp.isOwnerDrawing
      ? { accountCode: SYSTEM_ACCOUNTS.drawings }
      : exp.accountId
        ? { accountId: exp.accountId }
        : { accountCode: accountForCategory(exp.category, exp.descriptionText) };

    // Tax shown on a slip is money the business gets back, so it goes to the
    // tax control account rather than being buried in the cost. Drawings
    // carry no reclaimable tax, whatever the slip says.
    const tax =
      !exp.isOwnerDrawing && exp.taxCents && exp.taxCents > 0 && exp.taxCents < exp.amountCents
        ? exp.taxCents
        : 0;

    try {
      await postEntry({
        tenantId,
        entryDate: exp.spentOn,
        memo: exp.descriptionText,
        source: JournalSource.EXPENSE,
        sourceType: "expense",
        sourceId: exp.id,
        lines: [
          { ...debitLine, debitCents: exp.amountCents - tax },
          ...(tax > 0 ? [{ accountCode: SYSTEM_ACCOUNTS.salesTax, debitCents: tax }] : []),
          { accountCode: SYSTEM_ACCOUNTS.bank, creditCents: exp.amountCents },
        ],
      });
      result.expenses++;
    } catch (err) {
      result.problems.push(
        `Expense ${exp.id}: ${err instanceof Error ? err.message : "could not be posted"}`
      );
    }
  }

  return result;
}

export interface LedgerCoverage {
  postedEntries: number;
  /** Documents that exist but have never reached the journal. */
  unpostedInvoices: number;
  unpostedPayments: number;
  unpostedExpenses: number;
  upToDate: boolean;
}

/**
 * How much of the business has actually reached the books.
 *
 * Exists because "we have accounting now" is a claim that rots: something new
 * becomes postable, nobody wires it in, and the profit and loss quietly stops
 * matching reality. This is the number that makes that visible.
 */
export async function ledgerCoverage(tenantId: string): Promise<LedgerCoverage> {
  const [postedEntries, invoiceIds, paymentIds, expenseIds, posted] = await Promise.all([
    prisma.journalEntry.count({ where: { tenantId } }),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { id: true },
    }),
    prisma.transaction.findMany({
      where: { tenantId, type: "PAYMENT", status: { not: "CANCELLED" } },
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: { tenantId, status: { notIn: ["REJECTED", "DUPLICATE"] } },
      select: { id: true },
    }),
    prisma.journalEntry.findMany({
      where: { tenantId, sourceId: { not: null } },
      select: { sourceType: true, sourceId: true },
    }),
  ]);

  const postedKeys = new Set(posted.map((p) => `${p.sourceType}:${p.sourceId}`));
  const count = (ids: Array<{ id: string }>, type: string) =>
    ids.filter((r) => !postedKeys.has(`${type}:${r.id}`)).length;

  const unpostedInvoices = count(invoiceIds, "invoice");
  const unpostedPayments = count(paymentIds, "payment");
  const unpostedExpenses = count(expenseIds, "expense");

  return {
    postedEntries,
    unpostedInvoices,
    unpostedPayments,
    unpostedExpenses,
    upToDate: unpostedInvoices + unpostedPayments + unpostedExpenses === 0,
  };
}
