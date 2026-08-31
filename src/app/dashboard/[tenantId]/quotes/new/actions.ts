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

  const lineItemIds = formData.getAll("lineItemId").map(String);
  const lineItemNames = formData.getAll("lineItemName").map((v) => String(v).trim());
  const lineQuantities = formData.getAll("lineQuantity").map((v) => Number(v) || 1);
  const linePriceRands = formData.getAll("linePriceRand").map((v) => Number(v) || 0);
  const lineDiscountPercents = formData.getAll("lineDiscountPercent").map((v) => Number(v) || 0);
  const lineTaxRatePercents = formData.getAll("lineTaxRatePercent").map((v) => (v === "" ? null : Number(v)));
  const documentDiscountPercent = Number(formData.get("documentDiscountPercent") ?? 0) || 0;
  const subject = String(formData.get("subject") ?? "").trim();
  const poNumber = String(formData.get("poNumber") ?? "").trim();
  const salesPersonMembershipId = String(formData.get("salesPersonMembershipId") ?? "").trim();

  const rows = lineItemNames
    .map((itemName, i) => ({
      itemId: lineItemIds[i] ?? "",
      itemName,
      quantity: lineQuantities[i] ?? 1,
      priceRand: linePriceRands[i] ?? 0,
      discountPercent: lineDiscountPercents[i] ?? 0,
      taxRatePercent: lineTaxRatePercents[i] ?? undefined,
    }))
    .filter((r) => r.itemName && r.priceRand > 0);

  const quoteKindRaw = String(formData.get("quoteKind") ?? "BASIC");
  const quoteKind = quoteKindRaw === "PROPOSAL" ? QuoteKind.PROPOSAL : QuoteKind.BASIC;
  const introText = String(formData.get("introText") ?? "").trim();
  const scopeOfWork = String(formData.get("scopeOfWork") ?? "").trim();
  const projectLocation = String(formData.get("projectLocation") ?? "").trim();
  const systemInfo = String(formData.get("systemInfo") ?? "").trim();
  const performanceExpectancy = String(formData.get("performanceExpectancy") ?? "").trim();
  const projectTimeline = String(formData.get("projectTimeline") ?? "").trim();

  if (!customerName || rows.length === 0) {
    throw new Error("Customer name and at least one item are required.");
  }

  const customer = await createParty({
    tenantId: tenant.id,
    role: tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
    name: customerName,
    phone: customerPhone || undefined,
  });

  // Reuse the catalog product when one was picked for a row, instead of
  // creating a fresh throwaway Item every time — this is the actual
  // product-catalog integration point. Only trust the id if it really
  // belongs to this tenant and the name still matches what's shown (the
  // picker keeps them in sync client-side, but a stale/tampered form
  // shouldn't silently reuse someone else's catalog row).
  const lines = [];
  for (const row of rows) {
    const catalogMatch = row.itemId
      ? await prisma.item.findFirst({ where: { id: row.itemId, tenantId: tenant.id, name: row.itemName } })
      : null;

    const item =
      catalogMatch ??
      (await prisma.item.create({
        data: {
          tenantId: tenant.id,
          name: row.itemName,
          unitPriceCents: Math.round(row.priceRand * 100),
        },
      }));

    lines.push({
      itemId: item.id,
      quantity: row.quantity,
      unitPriceCents: Math.round(row.priceRand * 100),
      discountPercent: row.discountPercent,
      taxRatePercent: row.taxRatePercent ?? undefined,
    });
  }

  const quote = await createQuote({
    tenantId: tenant.id,
    partyId: customer.id,
    lines,
    quoteKind,
    introText: quoteKind === QuoteKind.PROPOSAL ? introText || undefined : undefined,
    scopeOfWork: quoteKind === QuoteKind.PROPOSAL ? scopeOfWork || undefined : undefined,
    projectLocation: quoteKind === QuoteKind.PROPOSAL ? projectLocation || undefined : undefined,
    systemInfo: quoteKind === QuoteKind.PROPOSAL ? systemInfo || undefined : undefined,
    performanceExpectancy: quoteKind === QuoteKind.PROPOSAL ? performanceExpectancy || undefined : undefined,
    projectTimeline: quoteKind === QuoteKind.PROPOSAL ? projectTimeline || undefined : undefined,
    discountPercent: documentDiscountPercent,
    subject: subject || undefined,
    poNumber: poNumber || undefined,
    salesPersonMembershipId: salesPersonMembershipId || undefined,
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
