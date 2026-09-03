"use server";

import { revalidatePath } from "next/cache";
import { InvolvementRole } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createParty } from "@/lib/core/parties";
import { startInvolvement, endInvolvement, recordDonation, addComplianceFiling, setRenewalDueDate } from "@/lib/core/nonprofit";

export async function addMemberAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  const role = String(formData.get("role") ?? "MEMBER") as InvolvementRole;
  if (!name) throw new Error("Name is required.");

  const partyRole = role === "SPONSOR" ? "SPONSOR" : "MEMBER";
  const party = await createParty({ tenantId, role: partyRole, name, phone });
  await startInvolvement({ tenantId, partyId: party.id, role });

  revalidatePath(`/dashboard/${tenantId}/members`);
}

export async function endInvolvementAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await endInvolvement(tenantId, String(formData.get("involvementId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/members`);
}

export async function setRenewalDateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const involvementId = String(formData.get("involvementId") ?? "");
  const renewalDueAtRaw = String(formData.get("renewalDueAt") ?? "");
  const renewalDueAt = new Date(renewalDueAtRaw);
  if (!involvementId || !renewalDueAtRaw || Number.isNaN(renewalDueAt.getTime())) {
    throw new Error("A valid renewal date is required.");
  }

  await setRenewalDueDate(tenantId, involvementId, renewalDueAt);
  revalidatePath(`/dashboard/${tenantId}/members`);
}

export async function recordDonationAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");

  const partyId = String(formData.get("partyId") ?? "");
  const amountCents = Math.round(Number(formData.get("amountRand") ?? 0) * 100);
  const designatedFund = String(formData.get("designatedFund") ?? "").trim() || undefined;
  if (!partyId || !amountCents) throw new Error("Donor and amount are required.");

  await recordDonation({ tenantId, partyId, amountCents, designatedFund });
  revalidatePath(`/dashboard/${tenantId}/members`);
}

export async function addFilingAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const filingType = String(formData.get("filingType") ?? "").trim();
  const filingDateRaw = String(formData.get("filingDate") ?? "");
  if (!filingType || !filingDateRaw) throw new Error("Filing type and date are required.");

  await addComplianceFiling({ tenantId, filingType, filingDate: new Date(filingDateRaw) });
  revalidatePath(`/dashboard/${tenantId}/members`);
}
