"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createQuote, sendQuote } from "@/lib/core/money";
import { PartyRole, QuoteKind } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function createQuoteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");

  // Confirms the signed-in user actually has a membership on this tenant
  // (not just a tenantId typed into a hidden field), and gets their real
  // role for the capability check below.
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();
  const itemName = String(formData.get("itemName") ?? "").trim();
  const itemId = String(formData.get("itemId") ?? "").trim();
  const priceRand = Number(formData.get("priceRand") ?? 0);
  const quantity = Number(formData.get("quantity") ?? 1);
  const quoteKindRaw = String(formData.get("quoteKind") ?? "BASIC");
  const quoteKind = quoteKindRaw === "PROPOSAL" ? QuoteKind.PROPOSAL : QuoteKind.BASIC;
  const introText = String(formData.get("introText") ?? "").trim();
  const scopeOfWork = String(formData.get("scopeOfWork") ?? "").trim();
  const projectLocation = String(formData.get("projectLocation") ?? "").trim();
  const systemInfo = String(formData.get("systemInfo") ?? "").trim();
  const performanceExpectancy = String(formData.get("performanceExpectancy") ?? "").trim();
  const projectTimeline = String(formData.get("projectTimeline") ?? "").trim();

  if (!customerName || !itemName || !priceRand) {
    throw new Error("Customer name, item, and price are required.");
  }

  const customer = await createParty({
    tenantId: tenant.id,
    role: tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
    name: customerName,
    phone: customerPhone || undefined,
  });

  // Reuse the catalog product when one was picked, instead of creating a
  // fresh throwaway Item every time — this is the actual product-catalog
  // integration point. Only trust the id if it really belongs to this
  // tenant and the name still matches what's shown (picker keeps them in
  // sync client-side, but a stale/tampered form shouldn't silently reuse
  // someone else's catalog row).
  const catalogMatch = itemId
    ? await prisma.item.findFirst({ where: { id: itemId, tenantId: tenant.id, name: itemName } })
    : null;

  const item =
    catalogMatch ??
    (await prisma.item.create({
      data: {
        tenantId: tenant.id,
        name: itemName,
        unitPriceCents: Math.round(priceRand * 100),
      },
    }));

  const quote = await createQuote({
    tenantId: tenant.id,
    partyId: customer.id,
    lines: [{ itemId: item.id, quantity, unitPriceCents: Math.round(priceRand * 100) }],
    quoteKind,
    introText: quoteKind === QuoteKind.PROPOSAL ? introText || undefined : undefined,
    scopeOfWork: quoteKind === QuoteKind.PROPOSAL ? scopeOfWork || undefined : undefined,
    projectLocation: quoteKind === QuoteKind.PROPOSAL ? projectLocation || undefined : undefined,
    systemInfo: quoteKind === QuoteKind.PROPOSAL ? systemInfo || undefined : undefined,
    performanceExpectancy: quoteKind === QuoteKind.PROPOSAL ? performanceExpectancy || undefined : undefined,
    projectTimeline: quoteKind === QuoteKind.PROPOSAL ? projectTimeline || undefined : undefined,
  });

  await sendQuote(quote.id);

  await recordAudit({
    tenantId: tenant.id,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:create",
    targetType: "Transaction",
    targetId: quote.id,
    metadata: { amountCents: quote.amountCents, customerId: customer.id },
  });

  redirect(`/dashboard/${tenant.id}/customers/${customer.id}`);
}
