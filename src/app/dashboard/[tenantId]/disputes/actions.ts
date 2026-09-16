"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { resolveDispute } from "@/lib/core/disputes";

export async function resolveDisputeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const disputeId = String(formData.get("disputeId") ?? "");
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  // Answering a customer's complaint is the same standing as writing to them.
  assertCan(access.role, "quote:send");

  await resolveDispute({ tenantId, disputeId, note: resolutionNote });

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
