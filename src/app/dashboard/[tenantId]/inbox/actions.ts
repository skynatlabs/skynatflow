"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { markEmailRead } from "@/lib/core/email";
import { markNotificationRead, markAllRead } from "@/lib/core/notifications2";
import { acceptDetails, markSubmissionHandled } from "@/lib/core/portal";

export async function markEmailReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markEmailRead(tenantId, String(formData.get("emailId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

export async function markNotificationReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markNotificationRead(tenantId, String(formData.get("notificationId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

export async function markAllNotificationsReadAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);
  await markAllRead(tenantId);
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

export async function handleSubmissionAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  await markSubmissionHandled(tenantId, String(formData.get("submissionId") ?? ""), access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}

/** Apply a customer's own correction to their record, once someone has read it. */
export async function acceptDetailsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  // Editing a customer's record is the same bar as editing what is sold to them.
  assertCan(access, "product:manage");
  await acceptDetails(tenantId, String(formData.get("submissionId") ?? ""), access.membershipId);
  revalidatePath(`/dashboard/${tenantId}/inbox`);
}
