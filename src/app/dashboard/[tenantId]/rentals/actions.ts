"use server";

import { revalidatePath } from "next/cache";
import { RentalRateUnit } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { markItemRentable, createRental, returnRental } from "@/lib/core/rentals";

export async function markRentableAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const itemId = String(formData.get("itemId") ?? "");
  const rentalRateCents = Math.round(Number(formData.get("rateRand") ?? 0) * 100);
  const rentalRateUnit = String(formData.get("rateUnit") ?? "DAY") as RentalRateUnit;

  await markItemRentable({ itemId, rentalRateCents, rentalRateUnit });
  revalidatePath(`/dashboard/${tenantId}/rentals`);
}

export async function createRentalAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const itemId = String(formData.get("itemId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  const endAtRaw = String(formData.get("endAt") ?? "");

  await createRental({ tenantId, itemId, partyId, endAt: endAtRaw ? new Date(endAtRaw) : undefined });
  revalidatePath(`/dashboard/${tenantId}/rentals`);
}

export async function returnRentalAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  await returnRental(String(formData.get("rentalId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/rentals`);
}
