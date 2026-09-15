// Matching statement lines to what the business already recorded.
//
// This is the one job in the product where an agent is genuinely better than
// a person, and not because it is cleverer: it is willing to consider four
// hundred candidates for one line, and a human reconciling on a Friday
// afternoon is not. That is the whole advantage, and it is enough.
//
// Three rules shape everything here:
//
//   NOTHING IS APPLIED ON ITS OWN. Every proposal carries a confidence and a
//   reason in plain words, and a person approves. An agent that silently
//   reconciled would be faster and completely untrustworthy — the value is in
//   doing the looking, not in taking the decision.
//
//   A REASON, NOT A SCORE. "87%" tells somebody nothing they can check.
//   "Exact amount, and Maré Plumbing is named in the description" is a claim
//   they can agree or disagree with in one second.
//
//   CORRECTIONS BECOME RULES. Being overruled once about SASOL should mean
//   never being wrong about SASOL again. That is what makes this improve
//   rather than being equally wrong every month.

import { prisma } from "@/lib/db";
import { JournalSource, type BankTransaction } from "@prisma/client";
import { postEntry, SYSTEM_ACCOUNTS } from "./ledger";

/** Days either side of a statement date still considered a plausible match. */
const DATE_WINDOW_DAYS = 10;

export type CandidateKind = "invoice" | "expense" | "account";

export interface MatchCandidate {
  kind: CandidateKind;
  id: string;
  label: string;
  amountCents: number;
  /** 0-100. Ordering only — the reasons are what a person actually reads. */
  confidence: number;
  reasons: string[];
}

export interface ProposedMatch {
  bankTransactionId: string;
  postedOn: Date;
  description: string;
  amountCents: number;
  best: MatchCandidate | null;
  alternatives: MatchCandidate[];
}

function daysApart(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

/**
 * Does a name appear in a statement description?
 *
 * Bank descriptions are truncated, capitalised oddly and stripped of
 * punctuation, so this compares the significant words rather than the whole
 * string. Words of three characters or fewer are skipped: matching on "the"
 * or "ltd" would make every candidate look plausible, which is worse than
 * matching on nothing.
 */
function nameAppearsIn(name: string, description: string): boolean {
  const haystack = description.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return false;
  return words.some((w) => haystack.includes(w));
}

/**
 * Candidates for one statement line, best first.
 *
 * Money in is matched against unpaid invoices; money out against recorded
 * expenses, then against a learned rule, then against nothing in particular —
 * and "nothing in particular" is a real answer that should be offered rather
 * than dressed up as a guess.
 */
async function candidatesFor(
  tenantId: string,
  line: BankTransaction
): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = [];
  const amount = Math.abs(line.amountCents);
  const moneyIn = line.amountCents > 0;

  const windowStart = new Date(line.postedOn.getTime() - DATE_WINDOW_DAYS * 86_400_000);
  const windowEnd = new Date(line.postedOn.getTime() + DATE_WINDOW_DAYS * 86_400_000);

  if (moneyIn) {
    // Invoices that are still owed. Deliberately not restricted to the date
    // window: a customer paying a three-month-old invoice is the normal case,
    // and the amount is the strong signal.
    const invoices = await prisma.transaction.findMany({
      where: {
        tenantId,
        type: "INVOICE",
        status: { in: ["SENT", "OVERDUE", "PARTIALLY_PAID"] },
      },
      select: {
        id: true,
        amountCents: true,
        createdAt: true,
        party: { select: { name: true } },
      },
      take: 400,
    });

    for (const inv of invoices) {
      const reasons: string[] = [];
      let confidence = 0;

      const exact = inv.amountCents === amount;
      if (exact) {
        confidence += 60;
        reasons.push("The amount matches exactly.");
      } else if (Math.abs(inv.amountCents - amount) <= Math.round(inv.amountCents * 0.01)) {
        confidence += 30;
        reasons.push("The amount is within 1% — possibly a bank charge taken off.");
      } else {
        continue; // Not a plausible payment for this invoice.
      }

      if (nameAppearsIn(inv.party.name, line.description)) {
        confidence += 35;
        reasons.push(`${inv.party.name} is named in the description.`);
      }

      const gap = daysApart(inv.createdAt, line.postedOn);
      if (gap <= 45) {
        confidence += 5;
        reasons.push(`Invoiced ${gap} day${gap === 1 ? "" : "s"} before this payment.`);
      }

      out.push({
        kind: "invoice",
        id: inv.id,
        label: `${inv.party.name} — invoice`,
        amountCents: inv.amountCents,
        confidence: Math.min(confidence, 99),
        reasons,
      });
    }
  } else {
    // Money out: an expense somebody already captured.
    const expenses = await prisma.expense.findMany({
      where: {
        tenantId,
        status: { not: "REJECTED" },
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, amountCents: true, descriptionText: true, createdAt: true },
      take: 400,
    });

    for (const exp of expenses) {
      if (exp.amountCents !== amount) continue;
      const reasons = ["The amount matches exactly."];
      let confidence = 60;

      if (nameAppearsIn(exp.descriptionText, line.description)) {
        confidence += 30;
        reasons.push("The wording matches what was captured.");
      }
      const gap = daysApart(exp.createdAt, line.postedOn);
      if (gap <= 3) {
        confidence += 8;
        reasons.push(gap === 0 ? "Captured the same day." : `Captured ${gap} days away.`);
      }

      out.push({
        kind: "expense",
        id: exp.id,
        label: exp.descriptionText,
        amountCents: exp.amountCents,
        confidence: Math.min(confidence, 99),
        reasons,
      });
    }

    // A rule the business taught us by correcting an earlier guess.
    const rules = await prisma.reconciliationRule.findMany({
      where: { tenantId },
      include: { account: { select: { id: true, code: true, name: true } } },
    });

    for (const rule of rules) {
      if (!line.description.toLowerCase().includes(rule.matchText.toLowerCase())) continue;
      // A rule that keeps getting overruled has stopped being a rule.
      if (rule.timesOverruled > rule.timesApplied) continue;

      out.push({
        kind: "account",
        id: rule.account.id,
        label: rule.account.name,
        amountCents: amount,
        confidence: Math.min(70 + rule.timesApplied * 3, 95),
        reasons: [
          `"${rule.matchText}" has gone to ${rule.account.name} ${rule.timesApplied} time${
            rule.timesApplied === 1 ? "" : "s"
          } before.`,
        ],
      });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export interface ReconciliationProposals {
  proposals: ProposedMatch[];
  /** Lines with no plausible candidate at all — the honest remainder. */
  unexplained: number;
  summary: string;
}

/**
 * Work through everything unmatched and say what each line looks like.
 *
 * Returns proposals rather than performing them. The caller shows a screenful,
 * a person approves in one pass, and what they overrule is fed back.
 */
export async function proposeMatches(
  tenantId: string,
  opts: { bankAccountId?: string; limit?: number } = {}
): Promise<ReconciliationProposals> {
  const lines = await prisma.bankTransaction.findMany({
    where: {
      tenantId,
      status: "UNMATCHED",
      ...(opts.bankAccountId ? { bankAccountId: opts.bankAccountId } : {}),
    },
    orderBy: { postedOn: "desc" },
    take: opts.limit ?? 100,
  });

  const proposals: ProposedMatch[] = [];
  let unexplained = 0;
  let confident = 0;

  for (const line of lines) {
    const candidates = await candidatesFor(tenantId, line);
    const best = candidates[0] ?? null;
    if (!best) unexplained++;
    // 80 is where a reason stops being "these numbers are equal" and starts
    // including a second, independent signal.
    if (best && best.confidence >= 80) confident++;

    proposals.push({
      bankTransactionId: line.id,
      postedOn: line.postedOn,
      description: line.description,
      amountCents: line.amountCents,
      best,
      alternatives: candidates.slice(1, 4),
    });
  }

  return {
    proposals,
    unexplained,
    summary: summarise(lines.length, confident, unexplained),
  };
}

function summarise(total: number, confident: number, unexplained: number): string {
  if (total === 0) return "Everything on the statement is accounted for.";
  const parts = [`${total} line${total === 1 ? "" : "s"} still to explain`];
  if (confident > 0) parts.push(`${confident} with a confident match ready to approve`);
  if (unexplained > 0) parts.push(`${unexplained} nothing matches at all`);
  return `${parts.join(", ")}.`;
}

// ------------------------------------------------------------------ acting

export interface AcceptResult {
  bankTransactionId: string;
  journalEntryId: string;
  /** True when a rule was created or strengthened from this decision. */
  learned: boolean;
}

/**
 * Accept a match: post it to the books and mark the line done.
 *
 * `rememberFor` is what turns this from data entry into something that gets
 * better — passing the recurring part of a description teaches the rule that
 * makes the next one automatic.
 */
export async function acceptMatch(params: {
  tenantId: string;
  bankTransactionId: string;
  kind: CandidateKind;
  targetId: string;
  /** Substring of the description to remember, for an account match. */
  rememberFor?: string | null;
  byAgent?: boolean;
  userId?: string | null;
}): Promise<AcceptResult> {
  const line = await prisma.bankTransaction.findUnique({
    where: { id: params.bankTransactionId },
    include: { bankAccount: { select: { accountId: true, tenantId: true } } },
  });
  if (!line || line.tenantId !== params.tenantId) throw new Error("Statement line not found.");
  if (line.status === "MATCHED") throw new Error("That line has already been matched.");

  const amount = Math.abs(line.amountCents);
  const bankAccountId = line.bankAccount.accountId;
  const moneyIn = line.amountCents > 0;

  let contraAccountId: string;
  let memo: string;

  if (params.kind === "invoice") {
    const invoice = await prisma.transaction.findUnique({
      where: { id: params.targetId },
      select: { tenantId: true, party: { select: { name: true } } },
    });
    if (!invoice || invoice.tenantId !== params.tenantId) throw new Error("Invoice not found.");

    const receivable = await prisma.account.findFirst({
      where: { tenantId: params.tenantId, code: SYSTEM_ACCOUNTS.receivable },
      select: { id: true },
    });
    if (!receivable) throw new Error("Open your books first.");

    contraAccountId = receivable.id;
    memo = `Payment received — ${invoice.party.name}`;
  } else if (params.kind === "expense") {
    const expense = await prisma.expense.findUnique({
      where: { id: params.targetId },
      select: { tenantId: true, descriptionText: true },
    });
    if (!expense || expense.tenantId !== params.tenantId) throw new Error("Expense not found.");

    const fallback = await prisma.account.findFirst({
      where: { tenantId: params.tenantId, code: SYSTEM_ACCOUNTS.otherExpense },
      select: { id: true },
    });
    if (!fallback) throw new Error("Open your books first.");

    contraAccountId = fallback.id;
    memo = expense.descriptionText;
  } else {
    const account = await prisma.account.findUnique({
      where: { id: params.targetId },
      select: { id: true, tenantId: true, name: true },
    });
    if (!account || account.tenantId !== params.tenantId) throw new Error("Account not found.");
    contraAccountId = account.id;
    memo = line.description;
  }

  // Money in debits the bank and credits whatever it came from; money out is
  // the mirror. Getting this backwards is the classic reconciliation bug, so
  // it is expressed once rather than at each branch above.
  const entry = await postEntry({
    tenantId: params.tenantId,
    entryDate: line.postedOn,
    memo,
    source: JournalSource.PAYMENT,
    sourceType: "bank_line",
    sourceId: line.id,
    byAgent: params.byAgent ?? false,
    createdById: params.userId ?? null,
    lines: moneyIn
      ? [
          { accountId: bankAccountId, debitCents: amount },
          { accountId: contraAccountId, creditCents: amount },
        ]
      : [
          { accountId: contraAccountId, debitCents: amount },
          { accountId: bankAccountId, creditCents: amount },
        ],
  });

  await prisma.bankTransaction.update({
    where: { id: line.id },
    data: {
      status: "MATCHED",
      matchedEntryId: entry.id,
      matchedAt: new Date(),
      matchedByAgent: params.byAgent ?? false,
    },
  });

  let learned = false;
  const remember = params.rememberFor?.trim();
  if (remember && remember.length >= 3 && params.kind === "account") {
    const existing = await prisma.reconciliationRule.findFirst({
      where: { tenantId: params.tenantId, matchText: remember },
    });
    if (existing) {
      await prisma.reconciliationRule.update({
        where: { id: existing.id },
        data: { accountId: contraAccountId, timesApplied: { increment: 1 } },
      });
    } else {
      await prisma.reconciliationRule.create({
        data: {
          tenantId: params.tenantId,
          matchText: remember,
          accountId: contraAccountId,
          timesApplied: 1,
        },
      });
    }
    learned = true;
  }

  return { bankTransactionId: line.id, journalEntryId: entry.id, learned };
}

/**
 * Record that a proposal was wrong.
 *
 * Only useful when a rule produced it — that is the thing that can learn. A
 * wrong guess from amount-matching alone carries no lesson worth storing.
 */
export async function recordOverrule(params: {
  tenantId: string;
  description: string;
}): Promise<number> {
  const rules = await prisma.reconciliationRule.findMany({
    where: { tenantId: params.tenantId },
    select: { id: true, matchText: true },
  });

  const hit = rules.filter((r) =>
    params.description.toLowerCase().includes(r.matchText.toLowerCase())
  );
  if (hit.length === 0) return 0;

  await prisma.reconciliationRule.updateMany({
    where: { id: { in: hit.map((r) => r.id) } },
    data: { timesOverruled: { increment: 1 } },
  });
  return hit.length;
}

/**
 * Set a line aside without posting it.
 *
 * An internal transfer between the business's own accounts, or a line the
 * bank later reversed. Kept rather than deleted so it does not reappear as
 * new on the next import.
 */
export async function ignoreLine(params: {
  tenantId: string;
  bankTransactionId: string;
  note?: string;
}) {
  const line = await prisma.bankTransaction.findUnique({
    where: { id: params.bankTransactionId },
    select: { tenantId: true },
  });
  if (!line || line.tenantId !== params.tenantId) throw new Error("Statement line not found.");

  return prisma.bankTransaction.update({
    where: { id: params.bankTransactionId },
    data: { status: "IGNORED", note: params.note ?? null },
  });
}

export async function listRules(tenantId: string) {
  return prisma.reconciliationRule.findMany({
    where: { tenantId },
    orderBy: { timesApplied: "desc" },
    include: { account: { select: { code: true, name: true } } },
  });
}
