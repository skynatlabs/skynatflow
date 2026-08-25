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

export async function approveExpense(expenseId: string, approvedById: string) {
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "APPROVED", approvedById },
  });
}

export async function rejectExpense(expenseId: string, approvedById: string) {
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "REJECTED", approvedById },
  });
}

export async function listExpenses(tenantId: string, status?: "PENDING" | "APPROVED" | "REJECTED") {
  const expenses = await prisma.expense.findMany({
    where: { tenantId, status },
    orderBy: { createdAt: "desc" },
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: expenses.map((e) => e.submittedById) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return expenses.map((e) => ({ ...e, submittedByName: nameById.get(e.submittedById) ?? "Someone" }));
}
