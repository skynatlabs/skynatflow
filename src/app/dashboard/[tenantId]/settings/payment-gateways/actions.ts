"use server";

import { revalidatePath } from "next/cache";
import { PaymentGatewayProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function connectPaymentGatewayAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const provider = String(formData.get("provider") ?? "") as PaymentGatewayProvider;
  const region = String(formData.get("region") ?? "RSA");
  const publicKey = String(formData.get("publicKey") ?? "").trim() || null;
  const secretKey = String(formData.get("secretKey") ?? "").trim() || null;

  await prisma.paymentGateway.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: { tenantId, provider, region, publicKey, secretKey, isActive: true },
    update: { publicKey, secretKey, isActive: true },
  });
  revalidatePath(`/dashboard/${tenantId}/settings/payment-gateways`);
}

export async function disconnectPaymentGatewayAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const provider = String(formData.get("provider") ?? "") as PaymentGatewayProvider;
  await prisma.paymentGateway.updateMany({
    where: { tenantId, provider },
    data: { isActive: false },
  });
  revalidatePath(`/dashboard/${tenantId}/settings/payment-gateways`);
}
