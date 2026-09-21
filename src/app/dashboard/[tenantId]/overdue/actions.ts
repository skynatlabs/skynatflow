"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { applyLateFee } from "@/lib/core/collections";
import { recordChase, type Tone } from "@/lib/core/collectionsLadder";

export async function applyLateFeeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "invoice:create");

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const feePercent = Number(formData.get("feePercent") ?? 5);

  await applyLateFee({ invoiceId, feePercent, tenantId });
  revalidatePath(`/dashboard/${tenantId}/overdue`);
}

/**
 * A rung was climbed.
 *
 * Recorded after the message has actually gone, whichever way it went — the
 * point of the record is that the next message knows what the last one said,
 * and a message written here but sent from a phone still counts.
 */
export async function recordChaseAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "quote:send");

  await recordChase({
    tenantId,
    transactionId: String(formData.get("invoiceId") ?? ""),
    step: Number(formData.get("step") ?? 1),
    channel: (String(formData.get("channel") ?? "whatsapp") as "whatsapp" | "email" | "call" | "letter"),
    tone: String(formData.get("tone") ?? "gentle") as Tone,
    body: String(formData.get("body") ?? "") || null,
    sentById: access.membershipId,
  });
  revalidatePath(`/dashboard/${tenantId}/overdue`);
}
