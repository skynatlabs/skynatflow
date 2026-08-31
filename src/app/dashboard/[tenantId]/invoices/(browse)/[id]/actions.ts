"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordPayment, recordRefund } from "@/lib/core/money";
import { setManualReminder, clearManualReminder } from "@/lib/core/followUpReminders";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

async function loadOwnedInvoice(tenantId: string, invoiceId: string) {
  const invoice = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.tenantId !== tenantId || invoice.type !== "INVOICE") throw new Error("Not found.");
  return invoice;
}

export async function recordPaymentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const amountRand = Number(formData.get("amountRand") ?? 0);
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");
  await loadOwnedInvoice(tenantId, invoiceId);
  if (!amountRand || amountRand <= 0) throw new Error("Enter a valid amount.");

  await recordPayment({ invoiceId, amountCents: Math.round(amountRand * 100) });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "Transaction",
    targetId: invoiceId,
    metadata: { action: "payment-recorded", amountCents: Math.round(amountRand * 100) },
  });

  revalidatePath(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}

export async function recordRefundAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const amountRand = Number(formData.get("amountRand") ?? 0);
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");
  await loadOwnedInvoice(tenantId, invoiceId);
  if (!amountRand || amountRand <= 0) throw new Error("Enter a valid amount.");

  await recordRefund({ invoiceId, amountCents: Math.round(amountRand * 100) });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "Transaction",
    targetId: invoiceId,
    metadata: { action: "refund-recorded", amountCents: Math.round(amountRand * 100) },
  });

  revalidatePath(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}

export async function setInvoiceSalesPersonAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const salesPersonMembershipId = String(formData.get("salesPersonMembershipId") ?? "").trim() || null;
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");
  await loadOwnedInvoice(tenantId, invoiceId);

  await prisma.transaction.update({ where: { id: invoiceId }, data: { salesPersonMembershipId } });
  revalidatePath(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}

export async function setInvoiceReminderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const remindAtRaw = String(formData.get("remindAt") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  const remindAt = new Date(remindAtRaw);
  if (!remindAtRaw || Number.isNaN(remindAt.getTime())) throw new Error("A valid date is required.");

  await setManualReminder({ tenantId, transactionId: invoiceId, remindAt, note });
  revalidatePath(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}

export async function clearInvoiceReminderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  await clearManualReminder(tenantId, invoiceId);
  revalidatePath(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}
