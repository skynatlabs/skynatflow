"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { clockIn, clockOut } from "@/lib/core/attendance";

export async function clockInAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await clockIn(tenantId, access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/attendance`);
}

export async function clockOutAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await clockOut(tenantId, access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/attendance`);
}
