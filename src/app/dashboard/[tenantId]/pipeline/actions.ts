"use server";

import { prisma } from "@/lib/db";
import { recordResponse } from "@/lib/core/money";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { revalidatePath } from "next/cache";

export async function markQuoteOutcomeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as "ACCEPTED" | "DECLINED";

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  const existing = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  if (existing.tenantId !== tenantId) throw new Error("Not found.");

  await recordResponse(quoteId, outcome);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:send",
    targetType: "Transaction",
    targetId: quoteId,
    metadata: { action: "manual-outcome", outcome },
  });

  revalidatePath(`/dashboard/${tenantId}/pipeline`);
}
