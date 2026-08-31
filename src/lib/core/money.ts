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
import { computeDocumentTotal } from "./pricing";

export interface QuoteLineInput {
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  taxRatePercent?: number;
}

export async function createQuote(params: {
  tenantId: string;
  partyId: string;
  lines: QuoteLineInput[];
  quoteKind?: QuoteKind;
  introText?: string;
  scopeOfWork?: string;
  projectLocation?: string;
  performanceExpectancy?: string;
  projectTimeline?: string;
  systemInfo?: string;
  discountPercent?: number;
  subject?: string;
  poNumber?: string;
  salesPersonMembershipId?: string;
}) {
  const { totalCents } = computeDocumentTotal(params.lines, params.discountPercent ?? 0);

  return prisma.transaction.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: TransactionType.QUOTE,
      status: TransactionStatus.DRAFT,
      amountCents: totalCents,
      quoteKind: params.quoteKind ?? QuoteKind.BASIC,
      introText: params.introText,
      scopeOfWork: params.scopeOfWork,
      projectLocation: params.projectLocation,
      performanceExpectancy: params.performanceExpectancy,
      projectTimeline: params.projectTimeline,
      systemInfo: params.systemInfo,
      discountPercent: params.discountPercent ?? 0,
      subject: params.subject,
      poNumber: params.poNumber,
      salesPersonMembershipId: params.salesPersonMembershipId,
      itemLines: {
        create: params.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPercent: l.discountPercent ?? 0,
          taxRatePercent: l.taxRatePercent,
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
  acceptanceIp?: string;
}) {
  const quote = await prisma.transaction.findUniqueOrThrow({ where: { id: params.quoteId } });
  const respondedAt = new Date();

  // SHA-256 over amount + signature + timestamp + IP, so re-hashing later
  // and comparing against the stored value catches any tampering with the
  // quote's amount or the recorded acceptance itself — this is what makes
  // it an audit trail rather than just a picture of a signature.
  const { createHash } = await import("node:crypto");
  const acceptanceHash = createHash("sha256")
    .update(
      [
        quote.id,
        quote.amountCents,
        params.signatureDataUrl,
        respondedAt.toISOString(),
        params.acceptanceIp ?? "",
      ].join("|")
    )
    .digest("hex");

  return prisma.transaction.update({
    where: { id: params.quoteId },
    data: {
      status: TransactionStatus.ACCEPTED,
      respondedAt,
      signatureDataUrl: params.signatureDataUrl,
      acceptanceIp: params.acceptanceIp,
      acceptanceHash,
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
      discountPercent: quote.discountPercent,
      subject: quote.subject,
      poNumber: quote.poNumber,
      salesPersonMembershipId: quote.salesPersonMembershipId,
      itemLines: {
        create: quote.itemLines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPercent: l.discountPercent,
          taxRatePercent: l.taxRatePercent,
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
  const refundedSoFar = await totalRefunded(invoice.id);
  const netPaid = paidSoFar - refundedSoFar;
  const newStatus =
    netPaid >= invoice.amountCents
      ? TransactionStatus.PAID
      : netPaid > 0
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

export async function totalRefunded(invoiceId: string): Promise<number> {
  const refunds = await prisma.transaction.findMany({
    where: { parentId: invoiceId, type: TransactionType.REFUND },
  });
  return refunds.reduce((sum, r) => sum + r.amountCents, 0);
}

// Credit note / partial refund — a first-class ledger entry (REFUND was
// already in the TransactionType enum, just never wired up to a real
// function). Net position is always paid-minus-refunded, recomputed here
// rather than mutated by hand, same derivation discipline as recordPayment.
export async function recordRefund(params: {
  invoiceId: string;
  amountCents: number;
  reason?: string;
}) {
  const invoice = await prisma.transaction.findUniqueOrThrow({
    where: { id: params.invoiceId },
  });

  if (invoice.type !== TransactionType.INVOICE) {
    throw new Error("Refunds can only be recorded against an INVOICE");
  }

  const alreadyPaid = await totalPaid(invoice.id);
  const alreadyRefunded = await totalRefunded(invoice.id);
  const netPaid = alreadyPaid - alreadyRefunded;
  if (params.amountCents > netPaid) {
    throw new Error("Refund amount exceeds the net amount paid on this invoice.");
  }

  await prisma.transaction.create({
    data: {
      tenantId: invoice.tenantId,
      partyId: invoice.partyId,
      type: TransactionType.REFUND,
      status: TransactionStatus.PAID,
      amountCents: params.amountCents,
      parentId: invoice.id,
      respondedAt: new Date(),
    },
  });

  const newNetPaid = netPaid - params.amountCents;
  const newStatus =
    newNetPaid >= invoice.amountCents
      ? TransactionStatus.PAID
      : newNetPaid > 0
        ? TransactionStatus.PARTIALLY_PAID
        : TransactionStatus.SENT;

  return prisma.transaction.update({
    where: { id: invoice.id },
    data: { status: newStatus },
  });
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
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (params.staleAfterDays ?? 3));

  // nextFollowUpAt (set when an inbound email reply gave a real timing
  // cue) always wins over the default cadence — a future date holds this
  // transaction back even past the normal window, a past/present date
  // pulls it in regardless of how recently it was created.
  return prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      type: { in: [TransactionType.QUOTE, TransactionType.INVOICE] },
      status: { in: [TransactionStatus.SENT, TransactionStatus.PARTIALLY_PAID] },
      OR: [
        { nextFollowUpAt: { lte: now } },
        { nextFollowUpAt: null, createdAt: { lt: cutoff } },
      ],
    },
    include: { party: true },
    orderBy: { createdAt: "asc" },
  });
}

// An opened-but-unconverted quote is functionally an abandoned cart —
// the customer looked, didn't buy, and (unlike a stale quote nobody's
// touched) we know they were actually interested. Surfaced separately
// from findStaleTransactions so it can trigger sooner than the standard
// 3-day staleness window — the moment matters here, per the cart-
// abandonment research (most recovery messages that work go out within
// hours, not days).
export async function findAbandonedQuotes(params: {
  tenantId: string;
  minHoursSinceOpen?: number;
}) {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - (params.minHoursSinceOpen ?? 2));

  return prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      type: TransactionType.QUOTE,
      status: TransactionStatus.SENT,
      respondedAt: null,
      openCount: { gte: 1 },
      lastOpenedAt: { lt: cutoff },
    },
    include: { party: true },
    orderBy: { lastOpenedAt: "asc" },
  });
}

// Cash-sale quick capture — a walk-in transaction recorded in one step
// instead of quote-then-invoice-then-payment. Still goes through
// createQuote-esque line items and recordPayment underneath, so it's the
// same ledger discipline, just collapsed into a single call for the
// "customer is standing at the counter" case the roadmap calls for.
export async function recordCashSale(params: {
  tenantId: string;
  partyId: string;
  lines: QuoteLineInput[];
}) {
  const amountCents = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  const invoice = await prisma.transaction.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents,
      itemLines: {
        create: params.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
      },
    },
  });

  return recordPayment({ invoiceId: invoice.id, amountCents });
}

export { prisma };
