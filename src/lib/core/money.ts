// The Business Graph API — money functions.
//
// These are the ONLY functions allowed to write Transaction rows. The owner
// UI calls these directly; the AI layer (Phase 3) calls the exact same
// functions as tool-calls. Nobody — human or AI — gets a separate code path,
// which is what makes the audit trail and the trust guarantees in the
// strategic report (Section 6.4) actually true rather than a claim.
//
// Money-logic tests in tests/core/money.test.ts assert against this file.

import { QuoteKind, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface QuoteLineInput {
  itemId: string;
  quantity: number;
  unitPriceCents: number;
}

export async function createQuote(params: {
  tenantId: string;
  partyId: string;
  lines: QuoteLineInput[];
  quoteKind?: QuoteKind;
  introText?: string;
  scopeOfWork?: string;
}) {
  const amountCents = params.lines.reduce(
    (sum, l) => sum + l.quantity * l.unitPriceCents,
    0
  );

  return prisma.transaction.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: TransactionType.QUOTE,
      status: TransactionStatus.DRAFT,
      amountCents,
      quoteKind: params.quoteKind ?? QuoteKind.BASIC,
      introText: params.introText,
      scopeOfWork: params.scopeOfWork,
      itemLines: {
        create: params.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
      },
    },
    include: { itemLines: true },
  });
}

export async function sendQuote(quoteId: string) {
  return prisma.transaction.update({
    where: { id: quoteId },
    data: { status: TransactionStatus.SENT },
  });
}

// Records a customer response (accept/decline) — this timestamp is what the
// follow-up/AR-chasing engine (Phase 3) watches to decide whether to escalate.
export async function recordResponse(
  transactionId: string,
  outcome: "ACCEPTED" | "DECLINED"
) {
  return prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status:
        outcome === "ACCEPTED"
          ? TransactionStatus.ACCEPTED
          : TransactionStatus.DECLINED,
      respondedAt: new Date(),
    },
  });
}

// Quote-open tracking (Soler's hot-lead pattern) — called when a customer
// opens their portal link for a quote. This is a buying signal independent
// of whether they've actually responded yet: a quote opened twice is a
// customer actively considering it, worth the owner's personal attention.
// Fires the hot-lead alert exactly once, the moment openCount crosses 2 —
// same "fire once, on the threshold crossing" pattern as Soler's
// AutomationService::onQuoteOpened.
export async function trackQuoteOpen(quoteId: string) {
  const before = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  const now = new Date();

  return prisma.transaction.update({
    where: { id: quoteId },
    data: {
      openCount: { increment: 1 },
      firstOpenedAt: before.firstOpenedAt ?? now,
      lastOpenedAt: now,
    },
  });
}

// Customer accepts a quote from the portal, with an e-signature (base64
// data URL from a canvas capture) — Soler's proven quote-signing UX,
// generalized. Records the response and stores the signature on the same
// transaction row, no separate document model needed.
export async function acceptQuoteWithSignature(params: {
  quoteId: string;
  signatureDataUrl: string;
}) {
  return prisma.transaction.update({
    where: { id: params.quoteId },
    data: {
      status: TransactionStatus.ACCEPTED,
      respondedAt: new Date(),
      signatureDataUrl: params.signatureDataUrl,
    },
  });
}

// Converts an accepted quote into an invoice. The invoice is a new,
// independent ledger row pointing back at the quote via parentId — the
// quote itself is never mutated. This is what keeps the ledger append-only
// and auditable.
export async function convertToInvoice(params: {
  quoteId: string;
  dueInDays?: number;
}) {
  const quote = await prisma.transaction.findUniqueOrThrow({
    where: { id: params.quoteId },
    include: { itemLines: true },
  });

  if (quote.type !== TransactionType.QUOTE) {
    throw new Error("Only a QUOTE can be converted to an invoice");
  }

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + (params.dueInDays ?? 14));

  return prisma.transaction.create({
    data: {
      tenantId: quote.tenantId,
      partyId: quote.partyId,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents: quote.amountCents,
      parentId: quote.id,
      dueAt,
      itemLines: {
        create: quote.itemLines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
      },
    },
    include: { itemLines: true },
  });
}

// Records a payment against an invoice. Supports partial payments (deposits)
// per the strategic report's requirement for high-ticket services like solar.
// The invoice's own status is derived, never directly set, from the sum of
// payments recorded against it — that derivation is what recordPayment does
// on every call, so the ledger can never drift out of sync with itself.
export async function recordPayment(params: {
  invoiceId: string;
  amountCents: number;
}) {
  const invoice = await prisma.transaction.findUniqueOrThrow({
    where: { id: params.invoiceId },
    include: { children: true },
  });

  if (invoice.type !== TransactionType.INVOICE) {
    throw new Error("Payments can only be recorded against an INVOICE");
  }

  await prisma.transaction.create({
    data: {
      tenantId: invoice.tenantId,
      partyId: invoice.partyId,
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PAID,
      amountCents: params.amountCents,
      parentId: invoice.id,
      respondedAt: new Date(),
    },
  });

  const paidSoFar = await totalPaid(invoice.id);
  const newStatus =
    paidSoFar >= invoice.amountCents
      ? TransactionStatus.PAID
      : paidSoFar > 0
        ? TransactionStatus.PARTIALLY_PAID
        : invoice.status;

  return prisma.transaction.update({
    where: { id: invoice.id },
    data: { status: newStatus, respondedAt: new Date() },
  });
}

export async function totalPaid(invoiceId: string): Promise<number> {
  const payments = await prisma.transaction.findMany({
    where: { parentId: invoiceId, type: TransactionType.PAYMENT },
  });
  return payments.reduce((sum, p) => sum + p.amountCents, 0);
}

export async function customerBalance(
  tenantId: string,
  partyId: string
): Promise<number> {
  const invoices = await prisma.transaction.findMany({
    where: { tenantId, partyId, type: TransactionType.INVOICE },
  });

  let balance = 0;
  for (const inv of invoices) {
    if (inv.status === TransactionStatus.CANCELLED) continue;
    const paid = await totalPaid(inv.id);
    balance += inv.amountCents - paid;
  }
  return balance;
}

// Powers the leakage report (strategic report, Section 10): every quote and
// invoice that's gone quiet past its threshold, tenant-wide.
export async function findStaleTransactions(params: {
  tenantId: string;
  staleAfterDays?: number;
}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (params.staleAfterDays ?? 3));

  return prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      type: { in: [TransactionType.QUOTE, TransactionType.INVOICE] },
      status: { in: [TransactionStatus.SENT, TransactionStatus.PARTIALLY_PAID] },
      createdAt: { lt: cutoff },
    },
    include: { party: true },
    orderBy: { createdAt: "asc" },
  });
}

export { prisma };
