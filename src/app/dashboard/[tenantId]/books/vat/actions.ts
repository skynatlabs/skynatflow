"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { fileVatReturn, saveDraftReturn } from "@/lib/core/vatReturn";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "invoice:create");
  return access;
}

export async function saveReturnAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  await saveDraftReturn(
    tenantId,
    new Date(String(formData.get("periodStart") ?? "")),
    new Date(String(formData.get("periodEnd") ?? ""))
  );
  revalidatePath(`/dashboard/${tenantId}/books/vat`);
}

/**
 * Filed. This is the irreversible one: from here the numbers are a record of
 * what was sent, not a calculation, and nothing that arrives later changes
 * them.
 */
export async function fileReturnAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  await fileVatReturn({
    tenantId,
    periodStart: new Date(String(formData.get("periodStart") ?? "")),
    periodEnd: new Date(String(formData.get("periodEnd") ?? "")),
    reference: String(formData.get("reference") ?? "") || null,
    filedById: access.membershipId,
  });
  revalidatePath(`/dashboard/${tenantId}/books/vat`);
}
