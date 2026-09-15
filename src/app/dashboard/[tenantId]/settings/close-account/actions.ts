"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { cancelClosure, requestClosure } from "@/lib/core/accountClosure";
import { recordAudit } from "@/lib/core/audit";

async function ownerOnly(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  if (access.role !== "OWNER") throw new Error("Only the owner can close this account.");
  return access;
}

export async function requestClosureAction(tenantId: string, formData: FormData) {
  const access = await ownerOnly(tenantId);
  await requestClosure(tenantId, access.userId, String(formData.get("confirmation") ?? ""));
  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { closure: "requested" },
  });
  revalidatePath(`/dashboard/${tenantId}`, "layout");
}

export async function cancelClosureAction(tenantId: string) {
  const access = await ownerOnly(tenantId);
  await cancelClosure(tenantId);
  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { closure: "cancelled" },
  });
  revalidatePath(`/dashboard/${tenantId}`, "layout");
}
