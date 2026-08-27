"use server";

import { revalidatePath } from "next/cache";
import { PropertyType } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createProperty, createLease, endLease } from "@/lib/core/property";

export async function addPropertyAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const address = String(formData.get("address") ?? "").trim();
  const propertyType = String(formData.get("propertyType") ?? "RESIDENTIAL") as PropertyType;
  const rentalRateRand = Number(formData.get("rentalRateRand") ?? 0);
  if (!address) throw new Error("Address is required.");

  await createProperty({
    tenantId,
    address,
    propertyType,
    rentalRateCents: rentalRateRand ? Math.round(rentalRateRand * 100) : undefined,
  });
  revalidatePath(`/dashboard/${tenantId}/properties`);
}

export async function addLeaseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const propertyId = String(formData.get("propertyId") ?? "");
  const renterPartyId = String(formData.get("renterPartyId") ?? "");
  const startDateRaw = String(formData.get("startDate") ?? "");
  const monthlyRentRand = Number(formData.get("monthlyRentRand") ?? 0);
  if (!propertyId || !renterPartyId || !startDateRaw) throw new Error("Property, renter, and start date are required.");

  await createLease({
    tenantId,
    propertyId,
    renterPartyId,
    startDate: new Date(startDateRaw),
    monthlyRentCents: Math.round(monthlyRentRand * 100),
  });
  revalidatePath(`/dashboard/${tenantId}/properties`);
}

export async function endLeaseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  await endLease(String(formData.get("leaseId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/properties`);
}
