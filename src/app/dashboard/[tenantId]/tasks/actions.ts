"use server";

import { revalidatePath } from "next/cache";
import { TaskStatus } from "@prisma/client";
import { createTask, updateTaskStatus } from "@/lib/core/tasks";

export async function createTaskAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "") || undefined;
  const dueAtRaw = String(formData.get("dueAt") ?? "");

  if (!tenantId || !title) {
    throw new Error("tenantId and title are required.");
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
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "TODO") as TaskStatus;

  await updateTaskStatus(taskId, status);
  revalidatePath(`/dashboard/${tenantId}/tasks`);
}
