"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createQuote, sendQuote } from "@/lib/core/money";
import { PartyRole } from "@prisma/client";

export async function createQuoteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();
  const itemName = String(formData.get("itemName") ?? "").trim();
  const priceRand = Number(formData.get("priceRand") ?? 0);
  const quantity = Number(formData.get("quantity") ?? 1);

  if (!customerName || !itemName || !priceRand) {
    throw new Error("Customer name, item, and price are required.");
  }

  const customer = await createParty({
    tenantId: tenant.id,
    role: tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
    name: customerName,
    phone: customerPhone || undefined,
  });

  const item = await prisma.item.create({
    data: {
      tenantId: tenant.id,
      name: itemName,
      unitPriceCents: Math.round(priceRand * 100),
    },
  });

  const quote = await createQuote({
    tenantId: tenant.id,
    partyId: customer.id,
    lines: [{ itemId: item.id, quantity, unitPriceCents: item.unitPriceCents }],
  });

  await sendQuote(quote.id);

  redirect(`/dashboard/${tenant.id}/customers/${customer.id}`);
}
