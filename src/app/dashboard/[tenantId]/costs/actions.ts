"use server";

import { revalidatePath } from "next/cache";
import { CapacityUnit } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { setAssetCapacity, setCostRate } from "@/lib/core/costing";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/costs`);
  revalidatePath(`/dashboard/${tenantId}/trips`);
}

/** Owner-level: what an hour of a person costs is not a number every colleague should see or set. */
export async function setCostRateAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  const raw = String(formData.get("ratePerHour") ?? "").trim();
  const cents = raw ? Math.round(Number(raw) * 100) : null;
  if (cents !== null && !Number.isFinite(cents)) throw new Error("That is not a number.");
  await setCostRate(tenantId, String(formData.get("membershipId") ?? ""), cents);
  refresh(tenantId);
}

export async function setAssetCapacityAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  const unit = String(formData.get("capacityUnit") ?? "").trim();
  await setAssetCapacity(tenantId, String(formData.get("assetId") ?? ""), {
    capacityUnit: unit ? (unit as CapacityUnit) : null,
    registration: String(formData.get("registration") ?? "").trim() || null,
  });
  refresh(tenantId);
}
