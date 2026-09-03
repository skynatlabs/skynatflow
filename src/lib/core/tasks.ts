// The Business Graph API — team task functions. Deliberately simple: one
// flat list, three states, assignable to any staff Membership. This is the
// "teamwork/task management" surface — real automation still runs through
// the AI/follow-up engine, not a rule builder bolted onto tasks.

import { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function createTask(params: {
  tenantId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  partyId?: string;
  dueAt?: Date;
}) {
  return prisma.task.create({ data: params });
}

export async function updateTaskStatus(tenantId: string, taskId: string, status: TaskStatus) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.tenantId !== tenantId) throw new Error("Task not found.");
  return prisma.task.update({ where: { id: taskId }, data: { status } });
}

export async function listTasks(tenantId: string) {
  return prisma.task.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}
