"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function disconnectCalendarAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await prisma.calendarIntegration.deleteMany({ where: { tenantId } });
  revalidatePath(`/dashboard/${tenantId}/settings/calendar`);
}
