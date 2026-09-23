"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { recordAudit } from "@/lib/core/audit";
import { setBenchmarkOptIn } from "@/lib/core/benchmarks";

/**
 * Turning comparison on, or off.
 *
 * Owner-only and audited, because it is a decision to contribute this
 * business's own figures to a pool — not a display preference. Turning it
 * off has to stay as easy as turning it on, or the consent was never real.
 */
export async function setComparisonAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  if (access.role !== "OWNER") throw new Error("Only the owner can change this.");

  const optedIn = formData.get("optedIn") === "on";
  await setBenchmarkOptIn(tenantId, optedIn);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { benchmarksOptedIn: optedIn },
  });

  revalidatePath(`/dashboard/${tenantId}/compare`);
}
