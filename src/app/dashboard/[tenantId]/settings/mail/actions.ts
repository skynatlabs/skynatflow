"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { connectImapAccount, connectFlowHostedAccount, disconnectEmailAccount } from "@/lib/core/email";

export async function connectImapAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const emailAddress = String(formData.get("emailAddress") ?? "").trim();
  const imapHost = String(formData.get("imapHost") ?? "").trim();
  const imapPort = Number(formData.get("imapPort") ?? 993);
  const imapUser = String(formData.get("imapUser") ?? "").trim();
  const imapPassword = String(formData.get("imapPassword") ?? "");

  if (!emailAddress || !imapHost || !imapUser || !imapPassword) {
    throw new Error("All IMAP fields are required.");
  }

  await connectImapAccount({ tenantId, emailAddress, imapHost, imapPort, imapUser, imapPassword });
  revalidatePath(`/dashboard/${tenantId}/settings/mail`);
}

export async function connectFlowHostedAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const emailAddress = String(formData.get("emailAddress") ?? "").trim();
  if (!emailAddress) throw new Error("Enter the address you'll forward mail from.");

  await connectFlowHostedAccount(tenantId, emailAddress);
  revalidatePath(`/dashboard/${tenantId}/settings/mail`);
}

export async function disconnectAccountAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await disconnectEmailAccount(tenantId, String(formData.get("accountId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/settings/mail`);
}
