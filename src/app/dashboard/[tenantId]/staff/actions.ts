"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan, type Role } from "@/lib/core/access";
import { inviteStaff, removeStaff, setStaffRole } from "@/lib/core/staff";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  return access;
}

export async function inviteStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  await inviteStaff({
    tenantId,
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: (String(formData.get("role") ?? "STAFF") as Role) || "STAFF",
    actorId: access.userId,
  });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}

export async function removeStaffAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  await removeStaff({
    tenantId,
    membershipId: String(formData.get("membershipId") ?? ""),
    actorId: access.userId,
  });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}

export async function setStaffRoleAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  await setStaffRole({
    tenantId,
    membershipId: String(formData.get("membershipId") ?? ""),
    role: String(formData.get("role") ?? "STAFF") as Role,
    actorId: access.userId,
  });

  revalidatePath(`/dashboard/${tenantId}/staff`);
}
