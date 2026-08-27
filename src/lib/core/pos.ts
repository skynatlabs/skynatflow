// Own built-in POS — till sessions, barcode/SKU lookup, and checkout.
// Checkout itself reuses recordCashSale (the exact function the manual
// cash-sale flow already uses) so the ledger discipline stays identical
// whether a sale came from the till or was typed in by hand.

import { prisma } from "@/lib/db";
import { PosProviderType } from "@prisma/client";
import { recordCashSale, type QuoteLineInput } from "./money";
import { getOrCreateWalkInParty } from "./parties";
import { POS_PROVIDERS } from "@/lib/pos/providers/registry";

export async function openTill(params: { tenantId: string; openedById: string; openingFloatCents: number }) {
  return prisma.tillSession.create({ data: params });
}

// Closes the session and computes the reconciliation variance — expected
// (opening float + cash sales during the session) vs. what was actually
// counted, same "surface it, don't absorb it" philosophy as Stocktake.
export async function closeTill(sessionId: string, closingCountedCents: number, closedById: string) {
  const session = await prisma.tillSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { payments: true },
  });

  const cashSalesCents = session.payments
    .filter((p) => p.paymentMethod === "cash")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const expectedCents = session.openingFloatCents + cashSalesCents;

  const closed = await prisma.tillSession.update({
    where: { id: sessionId },
    data: { closedById, closedAt: new Date(), closingCountedCents },
  });

  return { ...closed, expectedCents, varianceCents: closingCountedCents - expectedCents };
}

export async function findItemByBarcode(tenantId: string, code: string) {
  return prisma.item.findFirst({ where: { tenantId, sku: code, isActive: true } });
}

export async function checkoutSale(params: {
  tenantId: string;
  partyId?: string;
  lines: QuoteLineInput[];
  paymentMethod: "cash" | "card";
  tillSessionId?: string;
  posProvider?: PosProviderType;
}) {
  const party = params.partyId
    ? await prisma.party.findUniqueOrThrow({ where: { id: params.partyId } })
    : await getOrCreateWalkInParty(params.tenantId, "CUSTOMER");

  if (params.paymentMethod === "card" && params.posProvider) {
    const amountCents = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
    const integration = await prisma.posIntegration.findUnique({
      where: { tenantId_provider: { tenantId: params.tenantId, provider: params.posProvider } },
    });
    const provider = POS_PROVIDERS[params.posProvider].create(integration?.apiKey ?? null);
    const result = await provider.charge(amountCents, { tenantId: params.tenantId });
    if (!result.ok) throw new Error(result.error ?? "Card payment failed");
  }

  const invoice = await recordCashSale({ tenantId: params.tenantId, partyId: party.id, lines: params.lines });

  // Tag the PAYMENT row (not the invoice) with method/session — that's
  // what closeTill's reconciliation sums against.
  await prisma.transaction.updateMany({
    where: { parentId: invoice.id, type: "PAYMENT" },
    data: { paymentMethod: params.paymentMethod, tillSessionId: params.tillSessionId },
  });

  return invoice;
}
