"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { archiveThread, markThreadRead, replyToMessage, sendMail, threadKeyFor } from "@/lib/core/mailbox";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Writing to a customer is the same permission as messaging one anywhere else.
  assertCan(access, "quote:send");
  return access;
}

export async function replyAction(tenantId: string, inboundEmailId: string, threadKey: string, formData: FormData) {
  const access = await guard(tenantId);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("There is nothing in the reply.");

  await replyToMessage({ tenantId, inboundEmailId, body, sentById: access.membershipId });
  await markThreadRead(tenantId, threadKey);
  revalidatePath(`/dashboard/${tenantId}/mail`);
}

export async function composeAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  await sendMail({ tenantId, to, subject, body, sentById: access.membershipId });
  revalidatePath(`/dashboard/${tenantId}/mail`);
  redirect(`/dashboard/${tenantId}/mail?thread=${encodeURIComponent(threadKeyFor(to, subject))}`);
}

export async function archiveAction(tenantId: string, threadKey: string, archived: boolean) {
  await guard(tenantId);
  await archiveThread(tenantId, threadKey, archived);
  revalidatePath(`/dashboard/${tenantId}/mail`);
  redirect(`/dashboard/${tenantId}/mail`);
}

export async function markReadAction(tenantId: string, threadKey: string) {
  await guard(tenantId);
  await markThreadRead(tenantId, threadKey);
  revalidatePath(`/dashboard/${tenantId}/mail`);
}
