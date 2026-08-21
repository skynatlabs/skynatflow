"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { logFollowUpSent } from "@/lib/core/movement";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

async function loadDraft(tenantId: string, draftId: string) {
  const draft = await prisma.aiDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { party: true },
  });
  if (draft.tenantId !== tenantId) throw new Error("Not found.");
  if (draft.status !== "PENDING") throw new Error("Already resolved.");
  return draft;
}

export async function approveDraftAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const editedBody = String(formData.get("body") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  const draft = await loadDraft(tenantId, draftId);
  const finalBody = editedBody || draft.body;

  if (!draft.party.phone) throw new Error("This customer has no phone on file.");
  await sendWhatsAppMessage({ to: draft.party.phone, body: finalBody });

  await logFollowUpSent({
    tenantId,
    partyId: draft.partyId,
    transactionId: draft.transactionId,
    notes: `Follow-up #${draft.touchNumber} sent (approved by ${access.userId})`,
  });

  await prisma.aiDraft.update({
    where: { id: draftId },
    data: { status: "SENT", body: finalBody, resolvedAt: new Date() },
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:send",
    targetType: "AiDraft",
    targetId: draftId,
    metadata: { action: "approved", edited: finalBody !== draft.body },
  });

  revalidatePath(`/dashboard/${tenantId}/ai-drafts`);
}

export async function skipDraftAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  await loadDraft(tenantId, draftId);

  await prisma.aiDraft.update({
    where: { id: draftId },
    data: { status: "SKIPPED", resolvedAt: new Date() },
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:send",
    targetType: "AiDraft",
    targetId: draftId,
    metadata: { action: "skipped" },
  });

  revalidatePath(`/dashboard/${tenantId}/ai-drafts`);
}
