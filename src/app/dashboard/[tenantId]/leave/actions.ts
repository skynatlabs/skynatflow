"use server";

import { revalidatePath } from "next/cache";
import { LeaveKind } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { addHoliday, decideLeave, requestLeave } from "@/lib/core/people";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/leave`);
}

function parseDate(raw: FormDataEntryValue | null, label: string): Date {
  const text = String(raw ?? "").trim();
  const date = new Date(`${text}T12:00:00.000Z`);
  if (!text || Number.isNaN(date.getTime())) throw new Error(`${label} needs a valid date.`);
  return date;
}

/**
 * Put in a request.
 *
 * Deliberately not gated on staff:manage — asking for leave is something
 * everybody does, and a driver who can log a delivery can certainly ask for a
 * Friday off. Deciding is the part that needs authority.
 */
export async function requestLeaveAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);

  const membershipId = String(formData.get("membershipId") ?? "");
  // Anybody may request for themselves; requesting on somebody else's behalf
  // is a manager's act.
  if (membershipId && membershipId !== access.membershipId) {
    assertCan(access, "staff:manage");
  }

  await requestLeave({
    tenantId,
    membershipId: membershipId || access.membershipId!,
    kind: String(formData.get("kind") ?? "ANNUAL") as LeaveKind,
    startOn: parseDate(formData.get("startOn"), "Start date"),
    endOn: parseDate(formData.get("endOn"), "End date"),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
  });
  refresh(tenantId);
}

export async function decideLeaveAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await decideLeave({
    tenantId,
    leaveRequestId: String(formData.get("leaveRequestId") ?? ""),
    approve: formData.get("approve") === "true",
    decidedById: access.membershipId ?? access.userId,
  });
  refresh(tenantId);
}

export async function addHolidayAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await addHoliday({
    tenantId,
    name: String(formData.get("name") ?? ""),
    onDate: parseDate(formData.get("onDate"), "Date"),
  });
  refresh(tenantId);
}
