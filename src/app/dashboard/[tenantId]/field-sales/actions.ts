"use server";

import { revalidatePath } from "next/cache";
import { VisitOutcome } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { saveOutlet, saveRoute, startVisit, endVisit } from "@/lib/core/outlets";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/field-sales`);
}

export async function saveOutletAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "task:manage");

  const num = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };

  await saveOutlet({
    tenantId,
    partyId: String(formData.get("partyId")),
    code: String(formData.get("code") ?? "") || null,
    channel: String(formData.get("channel") ?? "") || null,
    tier: String(formData.get("tier") ?? "") || null,
    lat: num("lat"),
    lng: num("lng"),
    landmark: String(formData.get("landmark") ?? "") || null,
    visitFrequencyDays: num("visitFrequencyDays"),
    routeId: String(formData.get("routeId") ?? "") || null,
  });

  refresh(tenantId);
}

export async function saveRouteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "task:manage");

  const day = String(formData.get("dayOfWeek") ?? "").trim();

  await saveRoute({
    tenantId,
    name: String(formData.get("name") ?? ""),
    membershipId: String(formData.get("membershipId") ?? "") || null,
    dayOfWeek: day === "" ? null : Number(day),
  });

  refresh(tenantId);
}

/**
 * Arriving, from the desk rather than from a phone.
 *
 * No coordinates come with it, and the module says so on the record instead
 * of quietly marking it verified — a visit logged from an office is exactly
 * what the verification exists to distinguish.
 */
export async function logVisitAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  if (!access.membershipId) throw new Error("Only somebody on the team can record a visit.");

  const visit = await startVisit({
    tenantId,
    outletId: String(formData.get("outletId")),
    membershipId: access.membershipId,
  });

  await endVisit({
    tenantId,
    visitId: visit.visitId,
    outcome: String(formData.get("outcome") ?? "NO_ORDER") as VisitOutcome,
    note: String(formData.get("note") ?? "") || null,
  });

  refresh(tenantId);
}
