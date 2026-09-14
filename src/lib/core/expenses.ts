// Staff expense submission + approval — the receipt slip is optional and
// stored the same way e-signatures already are (a base64 data URL), so no
// object storage dependency for something this small.

import { prisma } from "@/lib/db";

export async function submitExpense(params: {
  tenantId: string;
  submittedById: string;
  descriptionText: string;
  amountCents: number;
  category?: string;
  receiptDataUrl?: string;
}) {
  return prisma.expense.create({ data: params });
}

async function requireOwnedExpense(tenantId: string, expenseId: string) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || expense.tenantId !== tenantId) throw new Error("Expense not found.");
  return expense;
}

export async function approveExpense(tenantId: string, expenseId: string, approvedById: string) {
  await requireOwnedExpense(tenantId, expenseId);
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "APPROVED", approvedById },
  });
}

export async function rejectExpense(tenantId: string, expenseId: string, approvedById: string) {
  await requireOwnedExpense(tenantId, expenseId);
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "REJECTED", approvedById },
  });
}

const EXPENSES_PAGE_SIZE = 25;

export async function listExpenses(
  tenantId: string,
  status?: "PENDING" | "APPROVED" | "REJECTED",
  page = 1
) {
  const where = { tenantId, status };
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * EXPENSES_PAGE_SIZE,
      take: EXPENSES_PAGE_SIZE,
    }),
    prisma.expense.count({ where }),
  ]);
  const memberships = await prisma.membership.findMany({
    where: { id: { in: expenses.map((e) => e.submittedById) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return {
    items: expenses.map((e) => ({ ...e, submittedByName: nameById.get(e.submittedById) ?? "Someone" })),
    total,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE)),
  };
}

// ------------------------------------------------- business vs the owner's own

/**
 * Say whether a payment was a cost of running the business or the owner
 * taking money out of it.
 *
 * These look identical on a bank statement and get booked identically by
 * almost every small business, which is the single biggest reason an owner
 * cannot answer "what does it actually cost to run this". Drawings recorded
 * as expenses make a profitable business look like it is barely surviving,
 * and the error compounds every month nobody separates them.
 */
export async function classifyExpense(params: {
  tenantId: string;
  expenseId: string;
  isOwnerDrawing: boolean;
}) {
  await requireOwnedExpense(params.tenantId, params.expenseId);
  return prisma.expense.update({
    where: { id: params.expenseId },
    data: { isOwnerDrawing: params.isOwnerDrawing },
  });
}

export interface SpendSplit {
  businessCents: number;
  drawingsCents: number;
  /** Not yet classified either way. The number that makes the other two honest. */
  unreviewedCents: number;
  unreviewedCount: number;
  from: Date;
  to: Date;
  /** One sentence, or empty when there is nothing worth saying. */
  summary: string;
}

/**
 * What went out, split three ways.
 *
 * The unreviewed bucket is reported rather than folded into either side.
 * Quietly counting unclassified spend as a business cost is precisely the
 * error this feature exists to correct, and doing it inside the fix would be
 * worse than not having the fix.
 */
export async function spendSplit(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<SpendSplit> {
  // The upper bound is the end of today, not this instant. A few seconds of
  // clock skew between the app and the database is ordinary, and an expense
  // recorded moments ago silently falling outside "the last twelve months"
  // is the kind of wrong total nobody reports and everybody stops trusting.
  const now = opts.to ?? new Date();
  const to = opts.to ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const from = opts.from ?? new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rows = await prisma.expense.findMany({
    // Rejected expenses were never spent, so they say nothing about where
    // the money went.
    where: { tenantId, status: { not: "REJECTED" }, createdAt: { gte: from, lte: to } },
    select: { amountCents: true, isOwnerDrawing: true },
  });

  let businessCents = 0;
  let drawingsCents = 0;
  let unreviewedCents = 0;
  let unreviewedCount = 0;

  for (const r of rows) {
    if (r.isOwnerDrawing === true) drawingsCents += r.amountCents;
    else if (r.isOwnerDrawing === false) businessCents += r.amountCents;
    else {
      unreviewedCents += r.amountCents;
      unreviewedCount++;
    }
  }

  const rands = (c: number) =>
    `R${(c / 100).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

  let summary = "";
  if (drawingsCents > 0 || unreviewedCount > 0) {
    const parts: string[] = [];
    if (drawingsCents > 0) {
      parts.push(`${rands(drawingsCents)} of what looks like spending was you, not the business`);
    }
    if (unreviewedCount > 0) {
      parts.push(
        `${unreviewedCount} payment${unreviewedCount === 1 ? "" : "s"} worth ` +
          `${rands(unreviewedCents)} ${unreviewedCount === 1 ? "has" : "have"} not been split either way`
      );
    }
    summary = `${parts.join(", and ")}.`;
  }

  return { businessCents, drawingsCents, unreviewedCents, unreviewedCount, from, to, summary };
}

/**
 * Payments nobody has split yet, newest first.
 *
 * This is what the agent works through: it can usually tell a fuel stop from
 * a restaurant, and asking about the handful it genuinely cannot is a far
 * better use of someone's attention than asking about all of them.
 */
export async function unclassifiedExpenses(tenantId: string, limit = 20) {
  return prisma.expense.findMany({
    where: { tenantId, status: { not: "REJECTED" }, isOwnerDrawing: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      descriptionText: true,
      amountCents: true,
      category: true,
      createdAt: true,
    },
  });
}
