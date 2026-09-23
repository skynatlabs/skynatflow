"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { setSupplierBankDetails } from "@/lib/core/supplierRisk";

/**
 * Changing where a supplier gets paid.
 *
 * Audited without exception. This is the write invoice fraud exists to
 * cause, and the only defence that survives contact with a convincing email
 * is a record of who changed it and when.
 */
export async function setBankDetailsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");

  const partyId = String(formData.get("partyId"));
  const result = await setSupplierBankDetails({
    tenantId,
    partyId,
    bankName: String(formData.get("bankName") ?? "") || null,
    bankAccountHolder: String(formData.get("accountHolder") ?? "") || null,
    bankAccountNumber: String(formData.get("accountNumber") ?? "") || null,
    changedById: access.membershipId,
  });

  if (result.changed) {
    await recordAudit({
      tenantId,
      actorType: "user",
      actorId: access.userId,
      capability: "payment:record",
      targetType: "Party",
      targetId: partyId,
      metadata: { bankDetailsChanged: true, wasFirstTime: result.wasFirstTime ?? false },
    });
  }

  revalidatePath(`/dashboard/${tenantId}/bill-check`);
}
