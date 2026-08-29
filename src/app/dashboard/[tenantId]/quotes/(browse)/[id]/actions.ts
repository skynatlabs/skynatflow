"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sendQuote, recordResponse, convertToInvoice } from "@/lib/core/money";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

async function loadOwnedQuote(tenantId: string, quoteId: string) {
  const quote = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.tenantId !== tenantId || quote.type !== "QUOTE") throw new Error("Not found.");
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
