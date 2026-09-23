"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { saveRecipe, deleteRecipe } from "@/lib/core/recipes";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/recipes`);
}

/**
 * Ingredients arrive as parallel arrays from one form: a row is an item and
 * an amount, and an empty amount means the row was left blank rather than
 * that the ingredient is used in none.
 */
export async function saveRecipeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  const itemIds = formData.getAll("componentItemId").map(String);
  const amounts = formData.getAll("amount").map((a) => String(a).trim());

  const components = itemIds
    .map((componentItemId, i) => ({ componentItemId, raw: amounts[i] ?? "" }))
    .filter((row) => row.componentItemId && row.raw !== "" && Number(row.raw) > 0)
    .map((row) => ({
      componentItemId: row.componentItemId,
      quantityThousandths: Math.round(Number(row.raw) * 1000),
    }));

  if (components.length === 0) throw new Error("A recipe needs at least one ingredient.");

  await saveRecipe({
    tenantId,
    dishItemId: String(formData.get("dishItemId")),
    yieldQty: Number(formData.get("yieldQty") ?? 1),
    note: String(formData.get("note") ?? "") || null,
    components,
  });

  refresh(tenantId);
}

export async function deleteRecipeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await deleteRecipe(tenantId, String(formData.get("dishItemId")));
  refresh(tenantId);
}
