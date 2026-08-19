"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { inviteConnection, respondToConnection } from "@/lib/core/connections";

export async function inviteConnectionAction(formData: FormData) {
  const supplierTenantId = String(formData.get("tenantId") ?? "");
  const buyerTenantName = String(formData.get("buyerTenantName") ?? "").trim();
  const discountPercent = Number(formData.get("discountPercent") ?? 0);

  const buyerTenant = await prisma.tenant.findFirst({ where: { name: buyerTenantName } });
  if (!buyerTenant) {
    throw new Error(`No workspace named "${buyerTenantName}" found.`);
  }

  await inviteConnection({
    supplierTenantId,
    buyerTenantId: buyerTenant.id,
    discountPercent: discountPercent || undefined,
  });

  revalidatePath(`/dashboard/${supplierTenantId}/connections`);
}

export async function acceptConnectionAction(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  await respondToConnection(connectionId, "ACCEPTED");
  revalidatePath(`/dashboard/${tenantId}/connections`);
}
