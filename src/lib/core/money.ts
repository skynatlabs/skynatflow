// The Business Graph API — money functions.
//
// These are the ONLY functions allowed to write Transaction rows. The owner
// UI calls these directly; the AI layer (Phase 3) calls the exact same
// functions as tool-calls. Nobody — human or AI — gets a separate code path,
// which is what makes the audit trail and the trust guarantees in the
// strategic report (Section 6.4) actually true rather than a claim.
//
// Money-logic tests in tests/core/money.test.ts assert against this file.

import { Prisma, QuoteKind, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/agent/events";
import { computeDocumentTotal } from "./pricing";
import { maybeSendReviewRequest } from "./reviews";

export interface QuoteLineInput {
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  taxRatePercent?: number;
  /** What this line says on the document, when the product's name is not it. */
  description?: string | null;
  /** How it is sold on this line: each, hour, kg, pallet. */
  unit?: string | null;
  /** Where it prints. A document is a sequence, not a set. */
  sortOrder?: number;
}

// Line-item and party ids on a quote/sale arrive from form selects, which
// the client controls. Without this, a document could be created in your
// own tenant while pointing at another company's customer or catalog
// items — which then leaked that customer's name/email into the rendered
// PDF and portal view, and aimed follow-up messages at them. Validated in
// one place here because createQuote and recordCashSale are the only two
// writers of itemLines.
async function assertPartyAndItemsInTenant(
  tenantId: string,
  partyId: string,
  lines: { itemId: string }[]
) {
  const party = await prisma.party.findUnique({ where: { id: partyId }, select: { tenantId: true } });
  if (!party || party.tenantId !== tenantId) throw new Error("Customer not found.");

  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
  if (itemIds.length === 0) return;
  const owned = await prisma.item.count({ where: { id: { in: itemIds }, tenantId } });
  if (owned !== itemIds.length) throw new Error("One or more products aren't in this workspace.");
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
  await assertPartyAndItemsInTenant(params.tenantId, params.partyId, params.lines);
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
        create: params.lines.map((l, i) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPercent: l.discountPercent ?? 0,
          taxRatePercent: l.taxRatePercent,
          description: l.description?.trim() || null,
          unit: l.unit?.trim() || null,
          sortOrder: l.sortOrder ?? i,
        })),
      },
    },
    include: { itemLines: true },
  });
}

// tenantId is required and appended: sending marks a quote SENT and is the
// trigger the follow-up engine watches, so a form post carrying another
// company's quote id must not be able to reach it. Appended rather than
// prepended because both params are strings — a missed call site then
// fails to compile instead of silently swapping arguments.
export async function sendQuote(quoteId: string, tenantId: string) {
  const quote = await prisma.transaction.findUnique({ where: { id: quoteId } });
  if (!quote || quote.tenantId !== tenantId || quote.type !== TransactionType.QUOTE) {
    throw new Error("Quote not found.");
  }
  const sent = await prisma.transaction.update({
    where: { id: quoteId },
    data: { status: TransactionStatus.SENT },
  });
  // The first quote out of the door is when setting up actually paid off, so
  // it is stamped once and never again.
  await prisma.tenant.updateMany({
    where: { id: tenantId, firstQuoteSentAt: null },
    data: { firstQuoteSentAt: new Date() },
  });
  return sent;
}

// Records a customer response (accept/decline) — this timestamp is what the
// follow-up/AR-chasing engine (Phase 3) watches to decide whether to escalate.
export async function recordResponse(
  transactionId: string,
  outcome: "ACCEPTED" | "DECLINED"
) {
  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status:
        outcome === "ACCEPTED"
          ? TransactionStatus.ACCEPTED
          : TransactionStatus.DECLINED,
      respondedAt: new Date(),
    },
  });

  await emitEvent({
    tenantId: updated.tenantId,
    type: outcome === "ACCEPTED" ? "quote.accepted" : "quote.declined",
    subjectType: "Transaction",
    subjectId: transactionId,
    payload: { amountCents: updated.amountCents },
  });

  return updated;
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

  const updated = await prisma.transaction.update({
    where: { id: quoteId },
    data: {
      openCount: { increment: 1 },
      firstOpenedAt: before.firstOpenedAt ?? now,
      lastOpenedAt: now,
    },
  });

  // Wake the agent on the crossing only, not on every subsequent open —
  // otherwise one interested customer generates an event per page refresh.
  if (before.openCount < 3 && updated.openCount >= 3 && !updated.respondedAt) {
    await emitEvent({
      tenantId: updated.tenantId,
      type: "quote.opened_repeatedly",
      subjectType: "Transaction",
      subjectId: quoteId,
      payload: { openCount: updated.openCount, amountCents: updated.amountCents },
    });
  }

  return updated;
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

  const updated = await prisma.transaction.update({
    where: { id: params.quoteId },
    data: {
      status: TransactionStatus.ACCEPTED,
      respondedAt,
      signatureDataUrl: params.signatureDataUrl,
      acceptanceIp: params.acceptanceIp,
      acceptanceHash,
    },
  });

  // recordResponse emits this for the accept/decline buttons, but signing is
  // the path most customers actually take — and until now it was silent, so
  // the agent never heard about the single most important thing that happens
  // in the business. A signed quote is work to schedule, stock to order and
  // an invoice to raise.
  await emitEvent({
    tenantId: updated.tenantId,
    type: "quote.accepted",
    subjectType: "Transaction",
    subjectId: updated.id,
    payload: { amountCents: updated.amountCents, signed: true },
  });

  return updated;
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
          // The wording and the order are part of the document, not decoration:
          // an invoice that renumbers or rewords the quote it came from is a
          // different document, and somebody has to reconcile the two.
          description: l.description,
          unit: l.unit,
          sortOrder: l.sortOrder,
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

  const updated = await prisma.transaction.update({
    where: { id: invoice.id },
    data: { status: newStatus, respondedAt: new Date() },
  });

  // PA job: the moment an invoice crosses fully into PAID, say thanks and
  // ask for a review — this was already built (src/lib/core/reviews.ts)
  // but never actually wired to the one place a payment gets recorded.
  if (newStatus === TransactionStatus.PAID) {
    await maybeSendReviewRequest(invoice.id);
    // Not actionable — nobody needs waking for good news — but it belongs in
    // the activity feed, and it is how the agent knows a chase can stop.
    await emitEvent({
      tenantId: invoice.tenantId,
      type: "invoice.paid",
      subjectType: "Transaction",
      subjectId: invoice.id,
      payload: { amountCents: invoice.amountCents },
    });
  }

  return updated;
}

export async function totalPaid(invoiceId: string): Promise<number> {
  const payments = await prisma.transaction.findMany({
    where: { parentId: invoiceId, type: TransactionType.PAYMENT },
  });
  return payments.reduce((sum, p) => sum + p.amountCents, 0);
}

/**
 * Paid less refunded, for many invoices in one query — the same sums
 * totalPaid and totalRefunded give one at a time.
 */
export async function netPaidByInvoice(invoiceIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(invoiceIds.map((id) => [id, 0]));
  if (invoiceIds.length === 0) return out;
  const sums = await prisma.transaction.groupBy({
    by: ["parentId", "type"],
    where: { parentId: { in: invoiceIds }, type: { in: [TransactionType.PAYMENT, TransactionType.REFUND] } },
    _sum: { amountCents: true },
  });
  for (const s of sums) {
    if (!s.parentId) continue;
    const cents = s._sum.amountCents ?? 0;
    out.set(s.parentId, (out.get(s.parentId) ?? 0) + (s.type === TransactionType.REFUND ? -cents : cents));
  }
  return out;
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
  return (await customerBalances(tenantId, partyId)).get(partyId) ?? 0;
}

/**
 * What customers owe — every invoice that was not cancelled, less what was
 * paid against it — for one customer or all of them, in one statement.
 * Worked out invoice by invoice this was a query per invoice, which is fine
 * for one customer and thousands of queries for a statements page.
 */
export async function customerBalances(tenantId: string, partyId?: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ partyId: string; balance: number }>>`
    SELECT i."partyId", (sum(i."amountCents") - coalesce(sum(p.paid), 0))::float8 AS balance
    FROM transactions i
    LEFT JOIN (
      SELECT "parentId", sum("amountCents") AS paid
      FROM transactions
      WHERE "tenantId" = ${tenantId} AND type = 'PAYMENT' AND "parentId" IS NOT NULL
      GROUP BY "parentId"
    ) p ON p."parentId" = i.id
    WHERE i."tenantId" = ${tenantId} AND i.type = 'INVOICE' AND i.status <> 'CANCELLED'
      ${partyId ? Prisma.sql`AND i."partyId" = ${partyId}` : Prisma.empty}
    GROUP BY i."partyId"
  `;
  return new Map(rows.map((r) => [r.partyId, r.balance]));
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

// A PA-style second pair of eyes: before a quote/invoice goes out, is
// this amount wildly out of line with what this customer normally pays?
// Judgment, not a fixed threshold — a first-ever order has nothing to
// compare against (never flagged), and the bar for "unusual" is relative
// to that specific customer's own history, not a platform-wide number.
export async function checkUnusualAmount(params: {
  tenantId: string;
  partyId: string;
  amountCents: number;
  excludeTransactionId?: string;
}): Promise<{ isUnusual: boolean; averageCents: number; multiple: number } | null> {
  const past = await prisma.transaction.findMany({
    where: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: { in: [TransactionType.QUOTE, TransactionType.INVOICE] },
      id: params.excludeTransactionId ? { not: params.excludeTransactionId } : undefined,
    },
    select: { amountCents: true },
    take: 50,
    orderBy: { createdAt: "desc" },
  });

  // Need real history to compare against — a brand-new customer's first
  // document is never "unusual," it's just their first.
  if (past.length < 2) return null;

  const averageCents = past.reduce((sum, t) => sum + t.amountCents, 0) / past.length;
  if (averageCents <= 0) return null;

  const multiple = params.amountCents / averageCents;
  return { isUnusual: multiple >= 3, averageCents, multiple };
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
  await assertPartyAndItemsInTenant(params.tenantId, params.partyId, params.lines);
  const amountCents = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  const invoice = await prisma.transaction.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      amountCents,
      itemLines: {
        create: params.lines.map((l, i) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          description: l.description?.trim() || null,
          unit: l.unit?.trim() || null,
          sortOrder: l.sortOrder ?? i,
        })),
      },
    },
  });

  return recordPayment({ invoiceId: invoice.id, amountCents });
}

export { prisma };
