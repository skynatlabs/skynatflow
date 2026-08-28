"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";

export async function saveAutomationSettingsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const autoRespondEnabled = formData.get("autoRespondEnabled") === "on";
  const followUpWindowDays = Number(formData.get("followUpWindowDays") ?? 3);
  const followUpRepeatDays = Number(formData.get("followUpRepeatDays") ?? 3);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { autoRespondEnabled, followUpWindowDays, followUpRepeatDays },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/automation`);
}
