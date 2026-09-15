"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { decide } from "@/lib/agent/observations";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Accepting or rejecting what the CFO found is an owner's call. A finding
  // dismissed here stays dismissed for ninety days, so this is not a button
  // that should be available to everyone who can open the dashboard.
  assertCan(access.role, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/brief`);
  revalidatePath(`/dashboard/${tenantId}`);
}

/**
 * Record what the owner decided about one finding.
 *
 * Both outcomes are recorded, not just the accepted ones. An officer that
 * cannot see what this business keeps turning down proposes the same rejected
 * thing forever, which is the fastest way to make a suite of executives feel
 * like a pool of features.
 */
export async function decideObservation(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const observationId = String(formData.get("observationId") ?? "");
  const actioned = String(formData.get("actioned") ?? "") === "yes";
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!observationId) throw new Error("Nothing to decide on.");

  await decide({
    tenantId,
    observationId,
    actioned,
    byId: access.membershipId,
    note,
  });

  refresh(tenantId);
}
