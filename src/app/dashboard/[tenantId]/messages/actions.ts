"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getOrCreateDmThread, createGroupThread, sendMessage } from "@/lib/core/messaging";
import { redirect } from "next/navigation";

export async function startDmAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const otherId = String(formData.get("otherId") ?? "");
  const thread = await getOrCreateDmThread(tenantId, access.membershipId, otherId);
  redirect(`/dashboard/${tenantId}/messages/${thread.id}`);
}

export async function startGroupAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const name = String(formData.get("name") ?? "").trim();
  const participantIds = formData.getAll("participantIds").map(String);
  if (!name) throw new Error("Group name is required.");

  const thread = await createGroupThread({
    tenantId,
    name,
    participantIds: Array.from(new Set([access.membershipId, ...participantIds])),
  });
  redirect(`/dashboard/${tenantId}/messages/${thread.id}`);
}

export async function sendMessageAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  await sendMessage({ tenantId, threadId, authorId: access.membershipId, body });
  revalidatePath(`/dashboard/${tenantId}/messages/${threadId}`);
}
