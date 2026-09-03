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
