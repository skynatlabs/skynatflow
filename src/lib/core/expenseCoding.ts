// Remembering the correction.
//
// The machine reads a slip and codes it. A person disagrees and fixes it.
// Without somewhere to put that disagreement, the same supplier is miscoded
// every month forever — which is how people stop trusting the reading and go
// back to typing, and the feature quietly dies while still technically
// working.
//
// So a correction becomes a rule, keyed on the thing that will recur: the
// supplier's name. Rules are applied on capture, before anybody sees the row,
// and the count of how often each has been used is kept — a rule applied
// forty times is the system having learned something, and a rule never
// applied is one somebody should be allowed to delete.
//
// Deliberately not a model. A lookup on a supplier name is right every time
// and costs nothing; a model asked to remember preferences is right most of
// the time and costs money on every slip.

import { prisma } from "@/lib/db";

/** The key a rule is stored under. Narrow, so it cannot match too much. */
export function matchKeyFor(params: { supplierName?: string | null; description?: string | null }): string | null {
  const supplier = params.supplierName?.trim().toLowerCase();
  if (supplier && supplier.length >= 3) return supplier;

  // Falling back to the description, take only the leading words — the whole
  // line includes amounts and dates that never repeat.
  const words = (params.description ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  return words.length >= 4 ? words : null;
}

export interface Correction {
  tenantId: string;
  /** What was corrected, so the key can be worked out. */
  supplierName?: string | null;
  description?: string | null;
  accountId?: string | null;
  category?: string | null;
  isOwnerDrawing?: boolean | null;
}

/**
 * Somebody disagreed. Write it down.
 *
 * A correction that says nothing — no account, no category, no drawings flag
 * — is not a correction and is ignored rather than stored as an empty rule
 * that matches everything and does nothing.
 */
export async function rememberCorrection(c: Correction) {
  const matchOn = matchKeyFor(c);
  if (!matchOn) return null;
  if (c.accountId === undefined && c.category === undefined && c.isOwnerDrawing === undefined) return null;

  if (c.accountId) {
    const account = await prisma.account.findFirst({ where: { id: c.accountId, tenantId: c.tenantId }, select: { id: true } });
    if (!account) throw new Error("That account is not in this workspace.");
  }

  return prisma.expenseCodingRule.upsert({
    where: { tenantId_matchOn: { tenantId: c.tenantId, matchOn } },
    create: {
      tenantId: c.tenantId,
      matchOn,
      accountId: c.accountId ?? null,
      category: c.category?.trim() || null,
      isOwnerDrawing: c.isOwnerDrawing ?? null,
    },
    update: {
      accountId: c.accountId ?? undefined,
      category: c.category?.trim() || undefined,
      isOwnerDrawing: c.isOwnerDrawing ?? undefined,
    },
  });
}

/** What this workspace has been taught, most-used first. */
export async function listCodingRules(tenantId: string) {
  return prisma.expenseCodingRule.findMany({
    where: { tenantId },
    orderBy: [{ timesApplied: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
}

export async function forgetCodingRule(tenantId: string, ruleId: string) {
  const { count } = await prisma.expenseCodingRule.deleteMany({ where: { id: ruleId, tenantId } });
  if (count === 0) throw new Error("There is no such rule on this workspace.");
  return { forgotten: true };
}

export interface CodingSuggestion {
  accountId: string | null;
  category: string | null;
  isOwnerDrawing: boolean | null;
  /** Which rule said so, for the "because you said so last time" line. */
  ruleId: string;
  matchedOn: string;
  timesApplied: number;
}

/** What this workspace has already decided about a cost like this one. */
export async function suggestCoding(params: {
  tenantId: string;
  supplierName?: string | null;
  description?: string | null;
}): Promise<CodingSuggestion | null> {
  const key = matchKeyFor(params);
  if (!key) return null;

  const rule = await prisma.expenseCodingRule.findUnique({
    where: { tenantId_matchOn: { tenantId: params.tenantId, matchOn: key } },
  });
  if (!rule) return null;

  return {
    accountId: rule.accountId,
    category: rule.category,
    isOwnerDrawing: rule.isOwnerDrawing,
    ruleId: rule.id,
    matchedOn: rule.matchOn,
    timesApplied: rule.timesApplied,
  };
}

/**
 * Apply what is known to a cost that has just been captured.
 *
 * Returns what it changed, so the row can say "coded to Fuel because you
 * said so last time" rather than silently filling fields in — a system that
 * quietly decides things is one nobody checks.
 */
export async function applyCoding(tenantId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, tenantId },
    select: { id: true, supplierName: true, descriptionText: true, accountId: true, category: true, isOwnerDrawing: true },
  });
  if (!expense) throw new Error("That cost is not in this workspace.");

  const suggestion = await suggestCoding({
    tenantId,
    supplierName: expense.supplierName,
    description: expense.descriptionText,
  });
  if (!suggestion) return { applied: false as const, reason: "Nothing has been taught about this supplier yet." };

  // Only fill what is empty. A rule must never overwrite something a person
  // set on this particular row.
  const data: { accountId?: string; category?: string; isOwnerDrawing?: boolean } = {};
  if (!expense.accountId && suggestion.accountId) data.accountId = suggestion.accountId;
  if (!expense.category && suggestion.category) data.category = suggestion.category;
  if (expense.isOwnerDrawing === null && suggestion.isOwnerDrawing !== null) data.isOwnerDrawing = suggestion.isOwnerDrawing;

  if (Object.keys(data).length === 0) {
    return { applied: false as const, reason: "It was already coded." };
  }

  await prisma.$transaction([
    prisma.expense.update({ where: { id: expense.id }, data }),
    prisma.expenseCodingRule.update({ where: { id: suggestion.ruleId }, data: { timesApplied: { increment: 1 } } }),
  ]);

  return {
    applied: true as const,
    fields: Object.keys(data),
    because: `You coded "${suggestion.matchedOn}" this way before.`,
    timesApplied: suggestion.timesApplied + 1,
  };
}
