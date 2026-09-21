"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { applySuggestedPrice } from "@/lib/core/repricing";

/**
 * Apply a new selling price, and bring the catalogue cost up to what is
 * actually being paid.
 *
 * Both halves matter. Repricing without correcting the cost leaves the
 * catalogue still claiming the old figure, so the item reappears on this page
 * tomorrow saying the margin has moved again — which is exactly the kind of
 * thing that teaches people to stop trusting a screen.
 */
export async function applyPriceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  const price = Number(formData.get("price"));
  if (!Number.isFinite(price) || price <= 0) throw new Error("A price has to be more than nothing.");

  const costCents = Number(formData.get("costCents"));

  await applySuggestedPrice({
    tenantId,
    itemId: String(formData.get("itemId") ?? ""),
    unitPriceCents: Math.round(price * 100),
    alsoUpdateCost: Number.isFinite(costCents) && costCents > 0 ? costCents : undefined,
  });

  revalidatePath(`/dashboard/${tenantId}/margins`);
  revalidatePath(`/dashboard/${tenantId}/products`);
}
