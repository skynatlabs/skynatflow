"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createAsset, issueAsset, returnAsset, retireAsset } from "@/lib/core/assets";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/assets`);
}

export async function addAssetAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const price = Number(formData.get("purchasePrice"));
  const life = Number(formData.get("usefulLifeMonths"));

  await createAsset({
    tenantId,
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "").trim() || null,
    serial: String(formData.get("serial") ?? "").trim() || null,
    purchaseCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
    usefulLifeMonths: Number.isInteger(life) && life > 0 ? life : null,
  });
  refresh(tenantId);
}

export async function issueAssetAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await issueAsset({
    tenantId,
    assetId: String(formData.get("assetId") ?? ""),
    toMembershipId: String(formData.get("membershipId") ?? ""),
  });
  refresh(tenantId);
}

export async function returnAssetAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await returnAsset({
    tenantId,
    assetId: String(formData.get("assetId") ?? ""),
    toRepair: formData.get("toRepair") === "on",
  });
  refresh(tenantId);
}

/**
 * Take something out of service.
 *
 * `lost` is a separate outcome from retired on purpose: equipment that walked
 * is a number worth surfacing, and folding it into "retired" hides exactly
 * the thing an owner would want to know about.
 */
export async function retireAssetAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await retireAsset({
    tenantId,
    assetId: String(formData.get("assetId") ?? ""),
    lost: formData.get("lost") === "true",
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  refresh(tenantId);
}
