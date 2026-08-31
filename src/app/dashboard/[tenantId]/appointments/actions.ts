"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { markNoShowAndRebook } from "@/lib/core/reminders";

export async function markNoShowAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  await requireTenantAccess(tenantId);

  await markNoShowAndRebook(eventId);
  revalidatePath(`/dashboard/${tenantId}/appointments`);
}
