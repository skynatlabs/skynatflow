"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { recordInTheField } from "@/lib/core/fieldMode";
import { sync } from "@/lib/core/offlineQueue";

/**
 * Something that happened on site.
 *
 * Queued rather than written, always — see the module for why. The sync
 * afterwards is an attempt, not a requirement: when it fails because there is
 * no signal, the record is already safe and will go up on the next one.
 */
export async function fieldAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("You are not on this workspace.");

  const jobCardId = String(formData.get("jobCardId") ?? "");
  const action = String(formData.get("action") ?? "") as "start" | "stop" | "photo" | "note" | "done";
  const clientRef = String(formData.get("clientRef") ?? "") || `${access.membershipId}-${jobCardId}-${action}-${Date.now()}`;

  const payload: Record<string, unknown> = {};
  const note = String(formData.get("note") ?? "").trim();
  if (note) payload.body = note;
  const photo = String(formData.get("photo") ?? "");
  if (photo.startsWith("data:image/")) payload.receiptDataUrl = photo;

  await recordInTheField({
    tenantId,
    membershipId: access.membershipId,
    jobCardId,
    action,
    at: new Date(),
    clientRef,
    payload,
  });

  await sync({ tenantId, membershipId: access.membershipId, changes: [] }).catch(() => null);

  revalidatePath(`/dashboard/${tenantId}/field`);
}
