// Multi-currency — the rate frozen onto the document at issue.
//
// A quote in dollars stays a quote in dollars. The rate to the workspace's
// own currency is written on the document when it is issued and never
// changed, so a paid invoice never silently restates and the agent never
// quotes two different truths about what it was worth. Reports read the
// frozen rate; nothing looks a rate up after the fact.

import { prisma } from "@/lib/db";
import { tenantCurrency } from "./currency";

/**
 * Put a document in a currency, at a rate. The rate is what one unit of the
 * document's currency is worth in the workspace's currency, given by the
 * person issuing it — a live feed is a dependency this app does not need and
 * a source of silent restatement it must not have.
 */
export async function setDocumentCurrency(params: {
  tenantId: string;
  transactionId: string;
  currency: string;
  rateToBase: number;
}) {
  const code = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("A currency is a three-letter code.");
  if (!(params.rateToBase > 0)) throw new Error("The rate has to be more than nothing.");
  const doc = await prisma.transaction.findFirst({ where: { id: params.transactionId, tenantId: params.tenantId }, select: { id: true, status: true, currency: true } });
  if (!doc) throw new Error("Document not found.");
  // Frozen means frozen: once anything has been paid against it the rate stays.
  if (doc.currency && ["PAID", "PARTIALLY_PAID"].includes(doc.status)) {
    throw new Error("This document has been paid against; its rate cannot change now.");
  }
  const base = await tenantCurrency(params.tenantId);
  return prisma.transaction.update({
    where: { id: doc.id },
    data: { currency: code === base ? null : code, fxRateToBase: code === base ? null : params.rateToBase },
  });
}

/** What a document's amount is in the workspace currency, at its frozen rate. */
export function baseAmountCents(doc: { amountCents: number; currency: string | null; fxRateToBase: number | null }): number {
  if (!doc.currency || !doc.fxRateToBase) return doc.amountCents;
  return Math.round(doc.amountCents * doc.fxRateToBase);
}

/** Documents not in the workspace currency, with their frozen worth. */
export async function foreignDocuments(tenantId: string, take = 50) {
  const rows = await prisma.transaction.findMany({
    where: { tenantId, currency: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, status: true, amountCents: true, currency: true, fxRateToBase: true, party: { select: { name: true } }, createdAt: true },
  });
  return rows.map((r) => ({ ...r, baseCents: baseAmountCents(r) }));
}
