// Job cards — the work-order layer for service businesses (solar
// installs, contractors): the physical work behind a sale, tracked
// separately from pricing/line-items which stay on the Transaction.

import { prisma } from "@/lib/db";

export async function createJobCard(params: {
  tenantId: string;
  transactionId: string;
  partyId: string;
  title: string;
  assignedToId?: string;
  scheduledAt?: Date;
  notes?: string;
  taskLabels?: string[];
}) {
  return prisma.jobCard.create({
    data: {
      tenantId: params.tenantId,
      transactionId: params.transactionId,
      partyId: params.partyId,
      title: params.title,
      assignedToId: params.assignedToId,
      scheduledAt: params.scheduledAt,
      notes: params.notes,
      tasks: {
        create: (params.taskLabels ?? []).map((label, i) => ({ label, sortOrder: i })),
      },
    },
    include: { tasks: true },
  });
}

export async function toggleJobCardTask(taskId: string) {
  const task = await prisma.jobCardTask.findUniqueOrThrow({ where: { id: taskId } });
  return prisma.jobCardTask.update({ where: { id: taskId }, data: { isDone: !task.isDone } });
}

export async function setJobCardStatus(jobCardId: string, status: "SCHEDULED" | "IN_PROGRESS" | "DONE") {
  return prisma.jobCard.update({
    where: { id: jobCardId },
    data: { status, completedAt: status === "DONE" ? new Date() : null },
  });
}

// A job card can only be marked DONE once every checklist item is
// ticked — the whole point of a checklist is that skipping a step isn't
// silently allowed just because someone's in a hurry to close it out.
export async function completeJobCard(jobCardId: string, completionPhotoUrl?: string) {
  const jobCard = await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId }, include: { tasks: true } });
  const incomplete = jobCard.tasks.filter((t) => !t.isDone);
  if (incomplete.length > 0) {
    throw new Error(`${incomplete.length} checklist item${incomplete.length === 1 ? "" : "s"} still need to be ticked off before this can be marked done.`);
  }

  return prisma.jobCard.update({
    where: { id: jobCardId },
    data: { status: "DONE", completedAt: new Date(), completionPhotoUrl },
  });
}

export async function listJobCards(tenantId: string) {
  return prisma.jobCard.findMany({
    where: { tenantId },
    include: { party: true, assignedTo: { include: { user: true } }, tasks: true, transaction: true },
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
  });
}
