"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { recordAudit } from "@/lib/core/audit";

// Deliberately NOT assertCan(role, capability) — this has to stay a hard
// role check. Any capability granted to STAFF is, by definition, something
// a compromised or dishonest staff login could exercise; banking details
// are exactly the field a fraud attempt would want to swap, so this is
// gated on OWNER specifically, not on whatever capability set STAFF
// happens to have today or gains later.
export async function updateBankingDetailsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (access.role !== "OWNER") {
    throw new Error("Only the business owner can change banking details.");
  }

  const data = {
    bankName: String(formData.get("bankName") ?? "").trim() || null,
    bankAccountHolder: String(formData.get("bankAccountHolder") ?? "").trim() || null,
    bankAccountNumber: String(formData.get("bankAccountNumber") ?? "").trim() || null,
    bankBranchCode: String(formData.get("bankBranchCode") ?? "").trim() || null,
    bankSwift: String(formData.get("bankSwift") ?? "").trim() || null,
    whatsappVerifyNumber: String(formData.get("whatsappVerifyNumber") ?? "").trim() || null,
  };

  await prisma.tenant.update({ where: { id: tenantId }, data });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "staff:manage",
    targetType: "Tenant",
    targetId: tenantId,
    metadata: { action: "banking_details_updated" },
  });

  revalidatePath(`/dashboard/${tenantId}/settings/banking`);
}
