"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  createDeliveryNote,
  deleteDraftNote,
  markDelivered,
  markSent,
  type DeliveryLineInput,
} from "@/lib/core/deliveryNotes";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Whoever can log a delivery can write the slip that goes with it.
  assertCan(access, "delivery:log");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/delivery-notes`);
}

export async function createDeliveryNoteAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const transactionId = String(formData.get("transactionId") ?? "").trim() || null;
  const partyId = String(formData.get("partyId") ?? "").trim() || null;

  // Free-typed lines: "12 x pallet wrap" one per row, or the document's own
  // outstanding lines when neither is given.
  const lines: DeliveryLineInput[] = [];
  const descriptions = formData.getAll("lineDescription").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const units = formData.getAll("lineUnit").map(String);
  for (const [i, description] of descriptions.entries()) {
    const quantity = Number(quantities[i] ?? "0");
    if (!description.trim() || !Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({ description: description.trim(), quantity, unit: units[i]?.trim() || null });
  }

  const note = await createDeliveryNote({
    tenantId,
    transactionId,
    partyId,
    lines,
    reference: String(formData.get("reference") ?? "").trim() || null,
    deliveryAddress: String(formData.get("deliveryAddress") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    createdById: access.membershipId,
  });

  refresh(tenantId);
  redirect(`/dashboard/${tenantId}/delivery-notes/${note.id}`);
}

export async function markSentAction(tenantId: string, noteId: string) {
  await guard(tenantId);
  await markSent(tenantId, noteId);
  refresh(tenantId);
}

export async function markDeliveredAction(tenantId: string, noteId: string, formData: FormData) {
  await guard(tenantId);
  await markDelivered(tenantId, noteId, { signedBy: String(formData.get("signedBy") ?? "").trim() || null });
  refresh(tenantId);
}

export async function deleteDraftAction(tenantId: string, noteId: string) {
  await guard(tenantId);
  await deleteDraftNote(tenantId, noteId);
  refresh(tenantId);
  redirect(`/dashboard/${tenantId}/delivery-notes`);
}
