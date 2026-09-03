"use server";

import { revalidatePath } from "next/cache";
import { TaskStatus } from "@prisma/client";
import { createTask, updateTaskStatus } from "@/lib/core/tasks";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function createTaskAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const title = String(formData.get("title") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "") || undefined;
  const dueAtRaw = String(formData.get("dueAt") ?? "");

  if (!title) {
    throw new Error("Title is required.");
  }

  await createTask({
    tenantId,
    title,
    assigneeId,
    dueAt: dueAtRaw ? new Date(dueAtRaw) : undefined,
  });

  revalidatePath(`/dashboard/${tenantId}/tasks`);
}

export async function moveTaskAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "TODO") as TaskStatus;

  await updateTaskStatus(tenantId, taskId, status);
  revalidatePath(`/dashboard/${tenantId}/tasks`);
}
