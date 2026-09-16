"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { orderTheDay, scheduleJob } from "@/lib/core/dispatch";
import { raiseDueVisits } from "@/lib/core/maintenance";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "task:manage");
  return access;
}

export async function scheduleJobAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  const date = String(formData.get("date") ?? "");
  await scheduleJob({
    tenantId,
    jobCardId: String(formData.get("jobCardId") ?? ""),
    scheduledAt: date ? new Date(date) : null,
    assignedToId: String(formData.get("assignedToId") ?? "") || null,
    estimatedMinutes: formData.get("minutes") ? Number(formData.get("minutes")) : undefined,
  });
  revalidatePath(`/dashboard/${tenantId}/dispatch`);
}

export async function orderDayAction(tenantId: string, date: string) {
  await guard(tenantId);
  await orderTheDay({ tenantId, date: new Date(date) });
  revalidatePath(`/dashboard/${tenantId}/dispatch`);
}

export async function raiseVisitsAction(tenantId: string) {
  await guard(tenantId);
  await raiseDueVisits(tenantId);
  revalidatePath(`/dashboard/${tenantId}/dispatch`);
}
