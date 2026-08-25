"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordStocktake } from "@/lib/core/stocktake";

export async function recordStocktakeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const itemId = String(formData.get("itemId") ?? "");
  const countedQty = Number(formData.get("countedQty") ?? 0);

  await recordStocktake({ tenantId, itemId, countedQty, countedById: access.membershipId });
  revalidatePath(`/dashboard/${tenantId}/stocktake`);
}
