"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createJobCard, toggleJobCardTask, completeJobCard, setJobCardStatus } from "@/lib/core/jobCards";

export async function createJobCardAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const [transactionId, partyId] = String(formData.get("jobRef") ?? "").split("|");
  const title = String(formData.get("title") ?? "").trim();
  const assignedToId = String(formData.get("assignedToId") ?? "").trim() || undefined;
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const taskLabels = String(formData.get("taskLabels") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!transactionId || !partyId || !title) throw new Error("A job, customer, and title are required.");

  await createJobCard({
    tenantId, transactionId, partyId, title, assignedToId,
    scheduledAt: scheduledAtRaw ? new Date(scheduledAtRaw) : undefined,
    taskLabels,
  });
  revalidatePath(`/dashboard/${tenantId}/job-cards`);
}

export async function toggleJobCardTaskAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  await toggleJobCardTask(String(formData.get("taskId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/job-cards`);
}

export async function setJobCardStatusAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const jobCardId = String(formData.get("jobCardId") ?? "");
  const status = String(formData.get("status") ?? "") as "SCHEDULED" | "IN_PROGRESS" | "DONE";
  await setJobCardStatus(jobCardId, status);
  revalidatePath(`/dashboard/${tenantId}/job-cards`);
}

export async function completeJobCardAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");

  const jobCardId = String(formData.get("jobCardId") ?? "");
  try {
    await completeJobCard(jobCardId);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Couldn't complete this job card.");
  }
  revalidatePath(`/dashboard/${tenantId}/job-cards`);
}
