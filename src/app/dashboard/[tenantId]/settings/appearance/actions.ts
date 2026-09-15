"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { setAccentForUser, isAccentPalette } from "@/lib/ai/model";

/**
 * Set the signed-in person's own accent colour.
 *
 * Deliberately not capability-gated. Every other setting in this app decides
 * something about the business and is owner-level; this decides what colour a
 * button is for one person, and gating it would mean a driver cannot choose
 * their own accent while being trusted to log deliveries.
 *
 * The user id comes from the session, never from the form — otherwise a
 * crafted post could change somebody else's preference.
 */
export async function setAccentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);

  const raw = String(formData.get("accent") ?? "");
  if (!isAccentPalette(raw)) throw new Error("No such palette.");

  await setAccentForUser(access.userId, raw);

  // The accent lives on the shell, which the layout renders, so the whole
  // dashboard has to be revalidated rather than just this page.
  revalidatePath(`/dashboard/${tenantId}`, "layout");
}
