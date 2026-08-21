"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordPayment, recordRefund, convertToInvoice } from "@/lib/core/money";
import { createRecurringInvoice, setRecurringInvoiceActive } from "@/lib/core/recurring";
import type { RecurrenceFrequency } from "@prisma/client";
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

export async function createRecurringInvoiceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const itemName = String(formData.get("itemName") ?? "").trim();
  const priceRand = Number(formData.get("priceRand") ?? 0);
  const quantity = Number(formData.get("quantity") ?? 1);
  const frequency = String(formData.get("frequency") ?? "MONTHLY") as RecurrenceFrequency;

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  if (!itemName || !priceRand) throw new Error("Item and price are required.");

  const catalogMatch = itemId
    ? await prisma.item.findFirst({ where: { id: itemId, tenantId, name: itemName } })
    : null;
  const item =
    catalogMatch ??
    (await prisma.item.create({
      data: { tenantId, name: itemName, unitPriceCents: Math.round(priceRand * 100) },
    }));

  const template = await createRecurringInvoice({
    tenantId,
    partyId: customerId,
    frequency,
    lines: [
      { itemId: item.id, name: itemName, quantity, unitPriceCents: Math.round(priceRand * 100) },
    ],
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "RecurringInvoice",
    targetId: template.id,
    metadata: { frequency, amountCents: quantity * Math.round(priceRand * 100) },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}

export async function toggleRecurringInvoiceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const nextActive = String(formData.get("nextActive") ?? "true") === "true";

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  const existing = await prisma.recurringInvoice.findUniqueOrThrow({ where: { id: templateId } });
  if (existing.tenantId !== tenantId) throw new Error("Not found.");

  await setRecurringInvoiceActive(templateId, nextActive);
  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}
