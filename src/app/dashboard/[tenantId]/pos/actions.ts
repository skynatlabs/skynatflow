"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { openTill, closeTill, checkoutSale } from "@/lib/core/pos";

export async function openTillAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");

  const openingFloatRand = Number(formData.get("openingFloatRand") ?? 0);
  await openTill({
    tenantId,
    openedById: access.membershipId ?? access.userId,
    openingFloatCents: Math.round(openingFloatRand * 100),
  });
  revalidatePath(`/dashboard/${tenantId}/pos`);
}

export async function closeTillAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");

  const sessionId = String(formData.get("sessionId") ?? "");
  const closingCountedRand = Number(formData.get("closingCountedRand") ?? 0);
  await closeTill(sessionId, Math.round(closingCountedRand * 100), access.membershipId ?? access.userId);
  revalidatePath(`/dashboard/${tenantId}/pos`);
}

export async function checkoutAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");

  const itemId = String(formData.get("itemId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  const unitPriceCents = Math.round(Number(formData.get("priceRand") ?? 0) * 100);
  const paymentMethod = String(formData.get("paymentMethod") ?? "cash") as "cash" | "card";
  const tillSessionId = String(formData.get("tillSessionId") ?? "") || undefined;

  await checkoutSale({
    tenantId,
    lines: [{ itemId, quantity, unitPriceCents }],
    paymentMethod,
    tillSessionId,
  });
  revalidatePath(`/dashboard/${tenantId}/pos`);
}
