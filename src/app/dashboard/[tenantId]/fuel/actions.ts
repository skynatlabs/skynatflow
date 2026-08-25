"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { logFuel } from "@/lib/core/fuel";

export async function logFuelAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  const driverId = String(formData.get("driverId") ?? "");
  const litres = Number(formData.get("litres") ?? 0);
  const costRand = Number(formData.get("costRand") ?? 0);
  const odometerKm = formData.get("odometerKm") ? Number(formData.get("odometerKm")) : undefined;

  if (!driverId || litres <= 0 || costRand <= 0) throw new Error("Driver, litres, and cost are required.");

  await logFuel({ tenantId, driverId, litres, costCents: Math.round(costRand * 100), odometerKm });
  revalidatePath(`/dashboard/${tenantId}/fuel`);
}
