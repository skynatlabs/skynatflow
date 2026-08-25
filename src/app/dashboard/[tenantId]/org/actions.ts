"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { setManager, setDepartment } from "@/lib/core/org";

export async function setManagerAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const membershipId = String(formData.get("membershipId") ?? "");
  const managerId = String(formData.get("managerId") ?? "") || null;

  await setManager(membershipId, managerId);
  revalidatePath(`/dashboard/${tenantId}/org`);
}

export async function setDepartmentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const membershipId = String(formData.get("membershipId") ?? "");
  const department = String(formData.get("department") ?? "").trim() || null;

  await setDepartment(membershipId, department);
  revalidatePath(`/dashboard/${tenantId}/org`);
}
