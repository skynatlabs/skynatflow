"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { applyLateFee } from "@/lib/core/collections";

export async function applyLateFeeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const feePercent = Number(formData.get("feePercent") ?? 5);

  await applyLateFee({ invoiceId, feePercent });
  revalidatePath(`/dashboard/${tenantId}/overdue`);
}
