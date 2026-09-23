"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { saveLoyaltyProgram, enrolMember, adjustPoints } from "@/lib/core/loyalty";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/rewards`);
}

/**
 * The earn rate decides how fast a business takes on a liability it will
 * have to honour, so this is owner-level and audited rather than a setting
 * anybody at a till can nudge.
 */
export async function saveRewardsProgramAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  const expiryRaw = String(formData.get("expireAfterDays") ?? "").trim();

  const program = await saveLoyaltyProgram(tenantId, {
    name: String(formData.get("name") ?? "Rewards"),
    isActive: formData.get("isActive") === "on",
    autoEnrol: formData.get("autoEnrol") === "on",
    earnPointsPerUnit: Number(formData.get("earnPointsPerUnit") ?? 1),
    redeemCentsPerPoint: Number(formData.get("redeemCentsPerPoint") ?? 10),
    minRedeemPoints: Number(formData.get("minRedeemPoints") ?? 50),
    expireAfterDays: expiryRaw === "" ? null : Number(expiryRaw),
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "LoyaltyProgram",
    targetId: program.id,
    metadata: {
      active: program.isActive,
      earnPointsPerUnit: program.earnPointsPerUnit,
      redeemCentsPerPoint: program.redeemCentsPerPoint,
    },
  });

  refresh(tenantId);
}

export async function enrolMemberAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await enrolMember({ tenantId, partyId: String(formData.get("partyId")) });
  refresh(tenantId);
}

/** Handing out value by hand. Audited, and the reason is not optional. */
export async function adjustPointsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");

  const partyId = String(formData.get("partyId"));
  const points = Number(formData.get("points") ?? 0);
  const reason = String(formData.get("reason") ?? "");

  await adjustPoints({ tenantId, partyId, points, note: reason });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "Party",
    targetId: partyId,
    metadata: { points, reason },
  });

  refresh(tenantId);
}
