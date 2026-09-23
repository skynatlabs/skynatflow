"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { recordCreditSale, recordRepayment } from "@/lib/core/khata";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/credit-book`);
}

/** Somebody took goods. One line, one press, and it is in the books. */
export async function addCreditEntryAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "invoice:create");

  const amount = Number(formData.get("amount") ?? 0);
  const partyId = String(formData.get("partyId") ?? "").trim();

  const result = await recordCreditSale({
    tenantId,
    partyId: partyId || undefined,
    customerName: String(formData.get("customerName") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    description: String(formData.get("description") ?? ""),
    amountCents: Math.round(amount * 100),
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "Transaction",
    targetId: result.invoiceId,
    metadata: { creditBook: true, amountCents: result.amountCents },
  });

  refresh(tenantId);
}

/** Somebody paid. Oldest first, and the allocation is not a choice. */
export async function addRepaymentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");

  const partyId = String(formData.get("partyId"));
  const amount = Number(formData.get("amount") ?? 0);

  const result = await recordRepayment({
    tenantId,
    partyId,
    amountCents: Math.round(amount * 100),
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "Party",
    targetId: partyId,
    metadata: {
      creditBook: true,
      appliedCents: result.paidCents,
      unallocatedCents: result.unallocatedCents,
    },
  });

  refresh(tenantId);
}
