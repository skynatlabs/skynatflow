// Skynat Go orders, landing in the merchant's own books.
//
// Every other channel in marketplaces.ts arrives as a settlement CSV the
// seller downloads once a month, because none of those marketplaces will hand
// this deployment an order feed. Skynat Go is the exception: it is ours, so a
// merchant selling on it can have each delivered order posted here as it
// happens — customer, lines, commission and payout, already reconciled.
//
// That is the whole pitch to a Go merchant: keep selling on Go, and your books
// keep themselves.
//
// Everything here is idempotent on (tenant, externalRef). Go retries a failed
// push, and a retry must never produce a second invoice for one order.

import { PartyRole, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordPayment } from "@/lib/core/money";

/** Reference written onto the invoice, and the key a retry is matched on. */
export function orderRef(orderId: string | number): string {
  return `skynat-go:order:${orderId}`;
}

export interface SkynatOrderLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  sku?: string | null;
}

export interface SkynatOrderInput {
  tenantId: string;
  /** The order id in Skynat Go. */
  orderId: string | number;
  storeName?: string | null;
  customer: { name: string; phone?: string | null; email?: string | null };
  lines: SkynatOrderLine[];
  /** What the customer paid, including delivery and tax. */
  totalCents: number;
  /**
   * What Skynat Go kept: commission, delivery fee, gateway charge. Shown on
   * the invoice's subject line for now — it is not yet posted as a cost of
   * its own, so profit reports still read gross.
   */
  feeCents?: number;
  /** True once the money is actually with the merchant (or paid in cash). */
  settled?: boolean;
  occurredAt?: Date;
}

export interface SkynatOrderResult {
  invoiceId: string;
  partyId: string;
  created: boolean;
}

/**
 * Posts one delivered Go order into this workspace as a paid invoice.
 *
 * Returns `created: false` when the order was already here, so the caller can
 * retry as often as it likes.
 */
export async function ingestDeliveryOrder(input: SkynatOrderInput): Promise<SkynatOrderResult> {
  const externalRef = orderRef(input.orderId);

  const existing = await prisma.transaction.findFirst({
    where: { tenantId: input.tenantId, externalRef },
    select: { id: true, partyId: true },
  });
  if (existing) {
    return { invoiceId: existing.id, partyId: existing.partyId, created: false };
  }

  const party = await findOrCreateCustomer(input);
  const lines = await resolveLines(input.tenantId, input.lines);

  // The customer's total is what the invoice says. The platform's cut is a
  // cost, not a smaller sale — netting it off here would quietly understate
  // turnover, which is the number VAT and every lender ask about.
  const amountCents = Math.max(0, Math.round(input.totalCents));

  const invoice = await prisma.transaction.create({
    data: {
      tenantId: input.tenantId,
      partyId: party.id,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents,
      externalRef,
      subject: subjectFor(input),
      createdAt: input.occurredAt ?? undefined,
      ...(lines.length > 0
        ? {
            itemLines: {
              create: lines.map((line, index) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                sortOrder: index,
              })),
            },
          }
        : {}),
    },
    select: { id: true, partyId: true },
  });

  // Go collects from the customer, so by the time an order is delivered the
  // money is in — the invoice is never "sent and waiting".
  if (input.settled !== false && amountCents > 0) {
    await recordPayment({ invoiceId: invoice.id, amountCents });
  }

  return { invoiceId: invoice.id, partyId: invoice.partyId, created: true };
}

function subjectFor(input: SkynatOrderInput): string {
  const parts = [`Skynat Go order #${input.orderId}`];
  if (input.storeName) parts.push(input.storeName);
  if (input.feeCents && input.feeCents > 0) {
    parts.push(`platform fee ${(input.feeCents / 100).toFixed(2)}`);
  }
  return parts.join(" — ");
}

/** Matches on phone first (the one thing a delivery order always has), then email. */
async function findOrCreateCustomer(input: SkynatOrderInput) {
  const phone = input.customer.phone?.trim() || null;
  const email = input.customer.email?.trim().toLowerCase() || null;

  const existing = await prisma.party.findFirst({
    where: {
      tenantId: input.tenantId,
      role: PartyRole.CUSTOMER,
      ...(phone ? { phone } : email ? { email } : { name: input.customer.name }),
    },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.party.create({
    data: {
      tenantId: input.tenantId,
      role: PartyRole.CUSTOMER,
      name: input.customer.name?.trim() || "Skynat Go customer",
      phone,
      email,
      notes: "Created from a Skynat Go order.",
    },
    select: { id: true },
  });
}

/**
 * Lines reference catalog items, so each product is matched by SKU (or name)
 * and created once. After a month of orders the merchant has a real catalogue
 * with real sales against it, which is what the margin reports read.
 */
async function resolveLines(tenantId: string, lines: SkynatOrderLine[]) {
  const resolved: Array<{ itemId: string; quantity: number; unitPriceCents: number }> = [];

  for (const line of lines) {
    const name = line.name?.trim() || "Item";
    const sku = line.sku?.trim() || null;

    const existing = await prisma.item.findFirst({
      where: { tenantId, ...(sku ? { sku } : { name }) },
      select: { id: true },
    });

    const item =
      existing ??
      (await prisma.item.create({
        data: {
          tenantId,
          name,
          sku,
          unitPriceCents: Math.max(0, Math.round(line.unitPriceCents)),
          category: "Skynat Go",
        },
        select: { id: true },
      }));

    resolved.push({
      itemId: item.id,
      quantity: Math.max(1, Math.round(line.quantity)),
      unitPriceCents: Math.max(0, Math.round(line.unitPriceCents)),
    });
  }

  return resolved;
}

/**
 * What the platform kept across a period — the number a merchant wants when
 * they ask whether selling on Go is worth it.
 */
export async function platformFees(tenantId: string, since: Date) {
  const orders = await prisma.transaction.findMany({
    where: { tenantId, externalRef: { startsWith: "skynat-go:order:" }, createdAt: { gte: since } },
    select: { amountCents: true },
  });

  const grossCents = orders.reduce((sum, o) => sum + o.amountCents, 0);

  return { orders: orders.length, grossCents };
}
