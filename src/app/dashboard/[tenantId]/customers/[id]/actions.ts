"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordPayment, recordRefund, convertToInvoice } from "@/lib/core/money";
import { maybeSendReviewRequest } from "@/lib/core/reviews";
import { createRecurringInvoice, setRecurringInvoiceActive } from "@/lib/core/recurring";
import { logDelivery } from "@/lib/core/movement";
import { createTask } from "@/lib/core/tasks";
import { EventType } from "@prisma/client";
import type { RecurrenceFrequency } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function updateCustomerAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const party = await prisma.party.findUniqueOrThrow({ where: { id: customerId } });
  if (party.tenantId !== tenantId) throw new Error("Not found.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");

  await prisma.party.update({
    where: { id: customerId },
    data: {
      name,
      companyName: String(formData.get("companyName") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      vatNumber: String(formData.get("vatNumber") ?? "").trim() || null,
      addressLine: String(formData.get("addressLine") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      postalCode: String(formData.get("postalCode") ?? "").trim() || null,
      country: String(formData.get("country") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}

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

  // One-click quote→invoice + job-card assignment — the "convert and
  // immediately hand the job to someone" flow, in the same submit instead
  // of two separate trips through the app.
  const assigneeId = String(formData.get("assigneeId") ?? "").trim();
  if (assigneeId) {
    await createTask({
      tenantId,
      title: `Job card — invoice ${invoice.id.slice(-6)}`,
      assigneeId,
      partyId: customerId,
    });
  }

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
  // No-op unless this payment just pushed the invoice to fully PAID and
  // the owner has a review link configured — safe to call unconditionally.
  await maybeSendReviewRequest(invoiceId);

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

  if (!itemName || !(priceRand > 0)) throw new Error("Item and a price greater than zero are required.");

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

export async function logPhotoEventAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const eventType = String(formData.get("eventType") ?? "SITE_VISIT") as EventType;
  const notes = String(formData.get("notes") ?? "").trim();
  const photoDataUrl = String(formData.get("photoDataUrl") ?? "").trim();

  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "delivery:log");

  await logDelivery({
    tenantId,
    partyId: customerId,
    type: eventType,
    notes: notes || undefined,
    photoUrl: photoDataUrl || undefined,
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "delivery:log",
    targetType: "Party",
    targetId: customerId,
    metadata: { eventType, hasPhoto: !!photoDataUrl },
  });

  revalidatePath(`/dashboard/${tenantId}/customers/${customerId}`);
}
