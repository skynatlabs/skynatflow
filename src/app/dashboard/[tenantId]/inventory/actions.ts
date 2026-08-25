"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordBatch } from "@/lib/core/inventory";

export async function recordBatchAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const itemId = String(formData.get("itemId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();

  await recordBatch({
    tenantId,
    itemId,
    quantity,
    expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
  });

  revalidatePath(`/dashboard/${tenantId}/inventory`);
}
