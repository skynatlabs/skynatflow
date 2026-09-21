"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { approveBill, buildPaymentRun, payBill, recordBill, releasePaymentRun, voidBill } from "@/lib/core/supplierBills";

async function guard(tenantId: string, capability: "invoice:create" | "payment:record" = "invoice:create") {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, capability);
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/payables`);
}

function cents(value: FormDataEntryValue | null): number {
  const s = String(value ?? "").replace(/[^0-9.,-]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export async function recordBillAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  await recordBill({
    tenantId,
    supplierId: String(formData.get("supplierId") ?? "") || null,
    supplierName: String(formData.get("supplierName") ?? "") || null,
    reference: String(formData.get("reference") ?? "") || null,
    amountCents: cents(formData.get("amount")),
    taxCents: formData.get("tax") ? cents(formData.get("tax")) : null,
    dueOn: new Date(String(formData.get("dueOn") ?? "")),
    issuedOn: formData.get("issuedOn") ? new Date(String(formData.get("issuedOn"))) : undefined,
    notes: String(formData.get("notes") ?? "") || null,
  });
  refresh(tenantId);
}

export async function approveBillAction(tenantId: string, billId: string) {
  const access = await guard(tenantId);
  await approveBill(tenantId, billId, access.membershipId);
  refresh(tenantId);
}

export async function voidBillAction(tenantId: string, billId: string) {
  await guard(tenantId);
  await voidBill(tenantId, billId);
  refresh(tenantId);
}

export async function payBillAction(tenantId: string, billId: string) {
  const access = await guard(tenantId, "payment:record");
  if (!access.membershipId) throw new Error("A cost has to be recorded by somebody.");
  await payBill({ tenantId, billId, submittedById: access.membershipId });
  refresh(tenantId);
}

export async function buildRunAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId, "payment:record");
  const dueBefore = String(formData.get("dueBefore") ?? "");
  await buildPaymentRun({
    tenantId,
    runOn: new Date(),
    dueBefore: dueBefore ? new Date(dueBefore) : undefined,
    createdById: access.membershipId,
  });
  refresh(tenantId);
}

export async function releaseRunAction(tenantId: string, runId: string) {
  const access = await guard(tenantId, "payment:record");
  if (!access.membershipId) throw new Error("A payment run has to be released by somebody.");
  await releasePaymentRun({ tenantId, runId, submittedById: access.membershipId });
  refresh(tenantId);
}
