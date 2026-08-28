"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { markEmailRead } from "@/lib/core/email";
import { markNotificationRead, markAllRead } from "@/lib/core/notifications2";

export async function markEmailReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markEmailRead(tenantId, String(formData.get("emailId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

export async function markNotificationReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markNotificationRead(String(formData.get("notificationId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

export async function markAllNotificationsReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markAllRead(tenantId);
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}
