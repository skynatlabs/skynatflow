// The Business Graph API — wholesaler-retailer connection functions
// (strategic report, Section 11). A supplier tenant invites a buyer tenant;
// once accepted, the buyer can place orders straight into the supplier's
// order flow — real supply-chain connection, not just a sales channel.

import { prisma } from "@/lib/db";
import { createQuote, sendQuote } from "./money";

export async function inviteConnection(params: {
  supplierTenantId: string;
  buyerTenantId: string;
  discountPercent?: number;
}) {
  return prisma.wholesaleConnection.create({
    data: {
      supplierTenantId: params.supplierTenantId,
      buyerTenantId: params.buyerTenantId,
      discountPercent: params.discountPercent,
      status: "PENDING",
    },
  });
}

export async function respondToConnection(
  connectionId: string,
  response: "ACCEPTED" | "DECLINED"
) {
  return prisma.wholesaleConnection.update({
    where: { id: connectionId },
    data: { status: response },
  });
}

export async function listConnectionsForTenant(tenantId: string) {
  return prisma.wholesaleConnection.findMany({
    where: {
      OR: [{ supplierTenantId: tenantId }, { buyerTenantId: tenantId }],
    },
    include: { supplierTenant: true, buyerTenant: true },
    orderBy: { createdAt: "desc" },
  });
}

// A retailer places an order directly against a connected supplier's
// catalog. This creates a Party record on the supplier's side representing
// the buyer tenant (so the order shows up in the supplier's normal quote
// pipeline, follow-up engine, and all), and a QUOTE/SENT transaction —
// same Business Graph functions the owner UI uses, no separate code path.
export async function placeConnectedOrder(params: {
  connectionId: string;
  lines: Array<{ itemId: string; quantity: number }>;
}) {
  const connection = await prisma.wholesaleConnection.findUniqueOrThrow({
    where: { id: params.connectionId },
    include: { supplierTenant: true, buyerTenant: true },
  });

  if (connection.status !== "ACCEPTED") {
    throw new Error("Connection must be ACCEPTED before placing orders");
  }

  // Find or create the buyer-tenant-as-customer Party on the supplier side.
  let buyerParty = await prisma.party.findFirst({
    where: {
      tenantId: connection.supplierTenantId,
      name: connection.buyerTenant.name,
      role: "CUSTOMER",
    },
  });
  if (!buyerParty) {
    buyerParty = await prisma.party.create({
      data: {
        tenantId: connection.supplierTenantId,
        role: "CUSTOMER",
        name: connection.buyerTenant.name,
        notes: `Connected wholesale account (buyer tenant ${connection.buyerTenantId})`,
      },
    });
  }

  const discount = connection.discountPercent ?? 0;
  const lines = await Promise.all(
    params.lines.map(async (l) => {
      const item = await prisma.item.findUniqueOrThrow({ where: { id: l.itemId } });
      const discountedPrice = Math.round(item.unitPriceCents * (1 - discount / 100));
      return { itemId: l.itemId, quantity: l.quantity, unitPriceCents: discountedPrice };
    })
  );

  const quote = await createQuote({
    tenantId: connection.supplierTenantId,
    partyId: buyerParty.id,
    lines,
  });
  await sendQuote(quote.id);

  return quote;
}
