"use server";

import { revalidatePath } from "next/cache";
import { PosProviderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function connectPosProviderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const provider = String(formData.get("provider") ?? "") as PosProviderType;
  const region = String(formData.get("region") ?? "RSA");
  const apiKey = String(formData.get("apiKey") ?? "").trim() || null;

  await prisma.posIntegration.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: { tenantId, provider, region, apiKey, isActive: true },
    update: { apiKey, isActive: true },
  });
  revalidatePath(`/dashboard/${tenantId}/settings/pos-integrations`);
}
