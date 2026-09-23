"use server";

import { revalidatePath } from "next/cache";
import { DeliveryOutcome } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { openRiderBag, assignToRider, recordAttempt, closeRiderBag } from "@/lib/core/cod";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/cod`);
}

export async function openBagAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");

  await openRiderBag({
    tenantId,
    riderMembershipId: String(formData.get("riderMembershipId")),
    openingFloatCents: Math.round(Number(formData.get("float") ?? 0) * 100),
  });

  refresh(tenantId);
}

export async function assignAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");

  const cod = String(formData.get("codAmount") ?? "").trim();

  await assignToRider({
    tenantId,
    deliveryNoteId: String(formData.get("deliveryNoteId")),
    riderMembershipId: String(formData.get("riderMembershipId")),
    codAmountCents: cod === "" ? null : Math.round(Number(cod) * 100),
  });

  refresh(tenantId);
}

export async function attemptAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");

  const collected = String(formData.get("collected") ?? "").trim();

  await recordAttempt({
    tenantId,
    deliveryNoteId: String(formData.get("deliveryNoteId")),
    outcome: String(formData.get("outcome") ?? "NOT_HOME") as DeliveryOutcome,
    collectedCents: collected === "" ? 0 : Math.round(Number(collected) * 100),
    note: String(formData.get("note") ?? "") || null,
  });

  refresh(tenantId);
}

/** The moment somebody is held to a shortfall, so it is audited. */
export async function closeBagAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");
  if (!access.membershipId) throw new Error("Only somebody on the team can settle a bag.");

  const settlementId = String(formData.get("settlementId"));
  const result = await closeRiderBag({
    tenantId,
    settlementId,
    countedCents: Math.round(Number(formData.get("counted") ?? 0) * 100),
    closedById: access.membershipId,
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "CodSettlement",
    targetId: settlementId,
    metadata: {
      expectedCents: result.expectedCents,
      countedCents: result.countedCents,
      varianceCents: result.varianceCents,
    },
  });

  refresh(tenantId);
}
