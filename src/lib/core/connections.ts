// The Business Graph API — wholesaler-retailer connection functions
// (strategic report, Section 11). A supplier tenant invites a buyer tenant;
// once accepted, the buyer can place orders straight into the supplier's
// order flow — real supply-chain connection, not just a sales channel.

import { prisma } from "@/lib/db";
import { createQuote, sendQuote, customerBalance } from "./money";

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

  // MOQ enforcement — catch a below-minimum line before it ever reaches
  // fulfillment, rather than after pick/pack cost has already been spent.
  const orderedItems = await Promise.all(
    params.lines.map((l) => prisma.item.findUniqueOrThrow({ where: { id: l.itemId } }))
  );
  for (let i = 0; i < params.lines.length; i++) {
    const item = orderedItems[i];
    const qty = params.lines[i].quantity;
    if (item.minOrderQty != null && qty < item.minOrderQty) {
      throw new Error(
        `${item.name} has a minimum order quantity of ${item.minOrderQty} (ordered ${qty})`
      );
    }
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
  const lines = orderedItems.map((item, i) => {
    const discountedPrice = Math.round(item.unitPriceCents * (1 - discount / 100));
    return { itemId: item.id, quantity: params.lines[i].quantity, unitPriceCents: discountedPrice };
  });
  const orderTotalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  // Credit-limit enforcement — checked against the buyer's current
  // outstanding balance on the supplier's own books, not a separate
  // ledger, so it's always in sync with real payment history.
  if (connection.creditLimitCents != null) {
    const outstanding = await customerBalance(connection.supplierTenantId, buyerParty.id);
    if (outstanding + orderTotalCents > connection.creditLimitCents) {
      throw new Error(
        `This order would exceed the buyer's credit limit (outstanding ${outstanding / 100} + ` +
          `order ${orderTotalCents / 100} > limit ${connection.creditLimitCents / 100})`
      );
    }
  }

  const quote = await createQuote({
    tenantId: connection.supplierTenantId,
    partyId: buyerParty.id,
    lines,
  });
  await sendQuote(quote.id);

  return quote;
}
