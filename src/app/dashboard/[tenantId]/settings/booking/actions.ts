"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { setBookingConfig, type BookingConfig } from "@/lib/core/booking";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function saveBookingConfigAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const config: BookingConfig = {
    enabled: formData.get("enabled") === "on",
    workDays: formData.getAll("workDays").map(Number),
    startHour: Number(formData.get("startHour") ?? 9),
    endHour: Number(formData.get("endHour") ?? 17),
    slotMins: Number(formData.get("slotMins") ?? 60),
  };

  await setBookingConfig(tenantId, config);
  revalidatePath(`/dashboard/${tenantId}/settings/booking`);
}

export async function saveReviewUrlAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const googleReviewUrl = String(formData.get("googleReviewUrl") ?? "").trim();
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { googleReviewUrl: googleReviewUrl || null },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/booking`);
}
