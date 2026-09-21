"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createGoal, updateGoalProgress } from "@/lib/core/goals";

export async function createGoalAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "task:manage");

  const title = String(formData.get("title") ?? "").trim();
  const metricLabel = String(formData.get("metricLabel") ?? "").trim();
  const targetValue = Number(formData.get("targetValue") ?? 0);
  const ownerId = String(formData.get("ownerId") ?? "") || undefined;
  const dueDateRaw = String(formData.get("dueDate") ?? "");

  if (!title || !metricLabel) throw new Error("Title and metric are required.");

  await createGoal({
    tenantId,
    title,
    metricLabel,
    targetValue,
    ownerId,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : undefined,
  });
  revalidatePath(`/dashboard/${tenantId}/goals`);
}

export async function updateGoalProgressAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "task:manage");

  const goalId = String(formData.get("goalId") ?? "");
  const currentValue = Number(formData.get("currentValue") ?? 0);

  await updateGoalProgress(goalId, currentValue, tenantId);
  revalidatePath(`/dashboard/${tenantId}/goals`);
}
