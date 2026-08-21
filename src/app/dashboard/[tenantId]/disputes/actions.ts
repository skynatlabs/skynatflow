"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function resolveDisputeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const disputeId = String(formData.get("disputeId") ?? "");
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  const dispute = await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
  if (dispute.tenantId !== tenantId) throw new Error("Not found.");

  await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: "RESOLVED", resolutionNote: resolutionNote || undefined, resolvedAt: new Date() },
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:send",
    targetType: "Dispute",
    targetId: disputeId,
    metadata: { resolutionNote },
  });

  revalidatePath(`/dashboard/${tenantId}/disputes`);
}
