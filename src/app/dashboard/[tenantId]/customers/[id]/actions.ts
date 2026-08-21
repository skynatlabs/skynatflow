"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordPayment, recordRefund, convertToInvoice } from "@/lib/core/money";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

async function verifyInvoiceInTenant(tenantId: string, invoiceId: string) {
  const invoice = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.tenantId !== tenantId || invoice.type !== "INVOICE") {
    throw new Error("Not found.");
  }
  return invoice;
}

export async function convertToInvoiceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  const quote = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.tenantId !== tenantId || quote.type !== "QUOTE") throw new Error("Not found.");

  const invoice = await convertToInvoice({ quoteId });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "Transaction",
    targetId: invoice.id,
    metadata: { fromQuoteId: quoteId, amountCents: invoice.amountCents },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}

export async function recordPaymentAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const amountRand = Number(formData.get("amountRand") ?? 0);

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");
  await verifyInvoiceInTenant(tenantId, invoiceId);

  if (!amountRand || amountRand <= 0) throw new Error("Enter a payment amount.");
  const amountCents = Math.round(amountRand * 100);

  await recordPayment({ invoiceId, amountCents });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "Transaction",
    targetId: invoiceId,
    metadata: { amountCents },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}

export async function recordRefundAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const amountRand = Number(formData.get("amountRand") ?? 0);

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");
  await verifyInvoiceInTenant(tenantId, invoiceId);

  if (!amountRand || amountRand <= 0) throw new Error("Enter a refund amount.");
  const amountCents = Math.round(amountRand * 100);

  await recordRefund({ invoiceId, amountCents });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "Transaction",
    targetId: invoiceId,
    metadata: { action: "refund", amountCents },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}
