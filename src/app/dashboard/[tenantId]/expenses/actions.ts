"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { submitExpense, approveExpense, rejectExpense } from "@/lib/core/expenses";

export async function submitExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const descriptionText = String(formData.get("descriptionText") ?? "").trim();
  const amountRand = Number(formData.get("amountRand") ?? 0);
  const category = String(formData.get("category") ?? "").trim() || undefined;
  const receiptDataUrl = String(formData.get("receiptDataUrl") ?? "").trim() || undefined;

  if (!descriptionText || amountRand <= 0) throw new Error("Description and amount are required.");

  await submitExpense({
    tenantId,
    submittedById: access.membershipId,
    descriptionText,
    amountCents: Math.round(amountRand * 100),
    category,
    receiptDataUrl,
  });
  revalidatePath(`/dashboard/${tenantId}/expenses`);
}

export async function approveExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await approveExpense(tenantId, String(formData.get("expenseId") ?? ""), access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/expenses`);
}

export async function rejectExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await rejectExpense(tenantId, String(formData.get("expenseId") ?? ""), access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/expenses`);
}
