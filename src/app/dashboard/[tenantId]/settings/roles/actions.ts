"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { deleteWorkspaceRole, saveWorkspaceRole } from "@/lib/core/roles";

/**
 * Defining a role is itself an administrative act.
 *
 * Guarded by staff:manage — the same capability that lets somebody change
 * who holds which role — and the core function separately refuses to grant
 * any capability the author does not hold. Two checks, because this is the
 * one screen where getting it wrong hands somebody the keys.
 */
export async function saveRoleAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await saveWorkspaceRole({
    tenantId,
    author: { ...access, userId: access.userId },
    key: String(formData.get("key") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? ""),
    capabilities: formData.getAll("capabilities").map(String),
  });

  revalidatePath(`/dashboard/${tenantId}/settings/roles`);
}

export async function deleteRoleAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await deleteWorkspaceRole({
    tenantId,
    key: String(formData.get("key") ?? ""),
    author: { userId: access.userId },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/roles`);
}
