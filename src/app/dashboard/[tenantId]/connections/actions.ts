"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { inviteConnection, respondToConnection } from "@/lib/core/connections";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function inviteConnectionAction(formData: FormData) {
  const supplierTenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(supplierTenantId);
  assertCan(access.role, "connection:invite");

  const buyerTenantName = String(formData.get("buyerTenantName") ?? "").trim();
  const discountPercent = Number(formData.get("discountPercent") ?? 0);

  const buyerTenant = await prisma.tenant.findFirst({ where: { name: buyerTenantName } });
  if (!buyerTenant) {
    throw new Error(`No workspace named "${buyerTenantName}" found.`);
  }

  const connection = await inviteConnection({
    supplierTenantId,
    buyerTenantId: buyerTenant.id,
    discountPercent: discountPercent || undefined,
  });

  await recordAudit({
    tenantId: supplierTenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "connection:invite",
    targetType: "WholesaleConnection",
    targetId: connection.id,
  });

  revalidatePath(`/dashboard/${supplierTenantId}/connections`);
}

export async function acceptConnectionAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "connection:accept");

  const connectionId = String(formData.get("connectionId") ?? "");
  await respondToConnection(tenantId, connectionId, "ACCEPTED");

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "connection:accept",
    targetType: "WholesaleConnection",
    targetId: connectionId,
  });

  revalidatePath(`/dashboard/${tenantId}/connections`);
}
