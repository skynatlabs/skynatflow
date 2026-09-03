"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sendQuote, recordResponse, convertToInvoice } from "@/lib/core/money";
import { setManualReminder, clearManualReminder } from "@/lib/core/followUpReminders";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

async function loadOwnedQuote(tenantId: string, quoteId: string) {
  // findUnique + an explicit check, not findUniqueOrThrow — a stale form
  // submission (quote deleted since the page loaded) or a mismatched
  // tenantId should fail as a normal, catchable error, not crash the
  // whole server action with an unhandled exception.
  const quote = await prisma.transaction.findUnique({ where: { id: quoteId } });
  if (!quote || quote.tenantId !== tenantId || quote.type !== "QUOTE") throw new Error("Quote not found.");
  return quote;
}

export async function sendQuoteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");
  await loadOwnedQuote(tenantId, quoteId);

  await sendQuote(quoteId);
  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}

// Plain-args variant (bindable via .bind(null, tenantId, quoteId) so a
// client component can call it directly without building a FormData) —
// used by the "Send via WhatsApp" button, which needs to trigger this
// from a click handler alongside opening the wa.me link.
export async function sendQuoteViaWhatsAppAction(tenantId: string, quoteId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");
  await loadOwnedQuote(tenantId, quoteId);

  await sendQuote(quoteId);
  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}

export async function markQuoteOutcomeAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as "ACCEPTED" | "DECLINED";
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");
  await loadOwnedQuote(tenantId, quoteId);

  await recordResponse(quoteId, outcome);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:send",
    targetType: "Transaction",
    targetId: quoteId,
    metadata: { action: "manual-outcome", outcome },
  });

  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}

export async function convertQuoteToInvoiceAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");
  await loadOwnedQuote(tenantId, quoteId);

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

  redirect(`/dashboard/${tenantId}/invoices/${invoice.id}`);
}

export async function setQuoteSalesPersonAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const salesPersonMembershipId = String(formData.get("salesPersonMembershipId") ?? "").trim() || null;
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");
  await loadOwnedQuote(tenantId, quoteId);

  await prisma.transaction.update({
    where: { id: quoteId },
    data: { salesPersonMembershipId },
  });
  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}

export async function setQuoteReminderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const remindAtRaw = String(formData.get("remindAt") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  const remindAt = new Date(remindAtRaw);
  if (!remindAtRaw || Number.isNaN(remindAt.getTime())) throw new Error("A valid date is required.");

  await setManualReminder({ tenantId, transactionId: quoteId, remindAt, note });
  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}

export async function clearQuoteReminderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:send");

  await clearManualReminder(tenantId, quoteId);
  revalidatePath(`/dashboard/${tenantId}/quotes/${quoteId}`);
}
