"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { submitClaim, markClaimDenied, markClaimReworked, markClaimPaid } from "@/lib/core/claims";

export async function submitClaimAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  const transactionId = String(formData.get("transactionId") ?? "");
  const payerName = String(formData.get("payerName") ?? "").trim();
  const claimedRand = Number(formData.get("claimedRand") ?? 0);

  if (!transactionId || !payerName || claimedRand <= 0) throw new Error("All fields are required.");

  await submitClaim({ tenantId, transactionId, payerName, claimedCents: Math.round(claimedRand * 100) });
  revalidatePath(`/dashboard/${tenantId}/claims`);
}

export async function markDeniedAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markClaimDenied(tenantId, String(formData.get("claimId") ?? ""), String(formData.get("denialReason") ?? "").trim());
  revalidatePath(`/dashboard/${tenantId}/claims`);
}

export async function markReworkedAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markClaimReworked(tenantId, String(formData.get("claimId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/claims`);
}

export async function markPaidAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markClaimPaid(tenantId, String(formData.get("claimId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/claims`);
}
