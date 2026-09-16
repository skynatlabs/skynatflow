// Everything that ever happened with one customer, in order.
//
// The information was all here and none of it was in one place: the quote on
// the quotes page, the invoice on the invoices page, the email in the
// mailbox, the WhatsApp in messages, the complaint in disputes, the proof of
// payment in the portal inbox. So the question every business actually asks
// before picking up the phone — "what is going on with these people?" — took
// six screens and still missed something.
//
// One read, merged and sorted. Deliberately a read: nothing here writes, and
// every entry points back at the thing it came from rather than copying it,
// so the timeline can never disagree with the record.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export type EntryKind =
  | "quote"
  | "invoice"
  | "payment"
  | "refund"
  | "email-in"
  | "email-out"
  | "portal"
  | "dispute"
  | "delivery"
  | "agreement"
  | "note"
  | "call"
  | "event"
  | "lead";

export interface TimelineEntry {
  id: string;
  kind: EntryKind;
  at: Date;
  /** One line, in the words somebody would use out loud. */
  title: string;
  detail?: string | null;
  amountCents?: number | null;
  /** Where to go to see the thing itself. Relative to the dashboard root. */
  href?: string | null;
  /** Who did it, where that is known. */
  by?: string | null;
  /** True when this came from the customer rather than the business. */
  fromThem?: boolean;
}

export interface Timeline {
  partyId: string;
  customer: string;
  entries: TimelineEntry[];
  /** The shape of the relationship, for the header. */
  summary: {
    firstSeen: Date | null;
    lastContact: Date | null;
    /** Days since anybody spoke to them. The number that matters most. */
    quietForDays: number | null;
    invoicedCents: number;
    paidCents: number;
    outstandingCents: number;
    documents: number;
    conversations: number;
  };
}

function when(d: Date | null | undefined): Date {
  return d ?? new Date(0);
}

export async function customerTimeline(
  tenantId: string,
  partyId: string,
  opts: { take?: number; now?: Date } = {}
): Promise<Timeline | null> {
  const now = opts.now ?? new Date();
  const party = await prisma.party.findFirst({
    where: { id: partyId, tenantId },
    select: { id: true, name: true, companyName: true, email: true, createdAt: true },
  });
  if (!party) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const money = (c: number) => formatMoney(c, tenant.currency);

  const [documents, emailsIn, emailsOut, submissions, disputes, deliveries, agreements, notes, calls, events, leads] =
    await Promise.all([
      prisma.transaction.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, type: true, status: true, amountCents: true, createdAt: true, subject: true, externalRef: true, parentId: true },
      }),
      party.email
        ? prisma.inboundEmail.findMany({
            where: { tenantId, OR: [{ partyId }, { fromAddress: { contains: party.email, mode: "insensitive" } }] },
            orderBy: { receivedAt: "desc" },
            take: 60,
            select: { id: true, subject: true, bodyText: true, receivedAt: true, fromAddress: true },
          })
        : Promise.resolve([]),
      prisma.outboundEmail.findMany({
        where: { tenantId, partyId },
        orderBy: { sentAt: "desc" },
        take: 60,
        select: { id: true, subject: true, bodyText: true, sentAt: true, status: true, error: true },
      }),
      prisma.portalSubmission.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, kind: true, body: true, createdAt: true, handledAt: true },
      }),
      prisma.dispute.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, message: true, status: true, createdAt: true, resolvedAt: true },
      }),
      prisma.deliveryNote.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, number: true, status: true, createdAt: true, deliveredAt: true },
      }),
      prisma.agreement.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, title: true, status: true, createdAt: true, signedAt: true, valueCents: true },
      }),
      prisma.note.findMany({
        where: { tenantId, entityType: "Party", entityId: partyId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, title: true, body: true, createdAt: true },
      }),
      prisma.callLog.findMany({
        where: { tenantId, partyId },
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { id: true, direction: true, status: true, durationSeconds: true, summary: true, startedAt: true },
      }),
      prisma.event.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, type: true, createdAt: true, notes: true },
      }),
      prisma.leadSubmission.findMany({
        where: { tenantId, partyId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, createdAt: true, source: true, form: { select: { title: true } } },
      }),
    ]);

  const entries: TimelineEntry[] = [];

  for (const d of documents) {
    if (d.type === "PAYMENT" || d.type === "REFUND") {
      entries.push({
        id: d.id,
        kind: d.type === "PAYMENT" ? "payment" : "refund",
        at: d.createdAt,
        title: d.type === "PAYMENT" ? `Paid ${money(d.amountCents)}` : `Refunded ${money(d.amountCents)}`,
        amountCents: d.amountCents,
        href: d.parentId ? `/invoices/${d.parentId}` : null,
        fromThem: d.type === "PAYMENT",
      });
      continue;
    }
    if (d.status === "DRAFT") continue;
    const isQuote = d.type === "QUOTE";
    entries.push({
      id: d.id,
      kind: isQuote ? "quote" : "invoice",
      at: d.createdAt,
      title: `${isQuote ? "Quote" : "Invoice"} ${d.externalRef ?? ""} · ${money(d.amountCents)}`.replace("  ", " "),
      detail: d.subject ?? d.status.replace(/_/g, " ").toLowerCase(),
      amountCents: d.amountCents,
      href: `${isQuote ? "/quotes" : "/invoices"}/${d.id}`,
    });
  }

  for (const e of emailsIn) {
    entries.push({
      id: e.id,
      kind: "email-in",
      at: e.receivedAt,
      title: e.subject || "(no subject)",
      detail: e.bodyText?.slice(0, 160) ?? null,
      by: e.fromAddress,
      fromThem: true,
      href: "/mail",
    });
  }
  for (const e of emailsOut) {
    entries.push({
      id: e.id,
      kind: "email-out",
      at: e.sentAt,
      title: e.subject || "(no subject)",
      detail: e.status === "FAILED" ? `Did not send: ${e.error ?? "no reason given"}` : e.bodyText?.slice(0, 160) ?? null,
      href: "/mail",
    });
  }

  const submissionLabel: Record<string, string> = {
    payment_proof: "Sent proof of payment",
    message: "Asked a question",
    details: "Corrected their details",
  };
  for (const s of submissions) {
    entries.push({
      id: s.id,
      kind: "portal",
      at: s.createdAt,
      title: submissionLabel[s.kind] ?? s.kind,
      detail: s.body,
      fromThem: true,
      href: "/inbox",
    });
  }

  for (const d of disputes) {
    entries.push({
      id: d.id,
      kind: "dispute",
      at: d.createdAt,
      title: "Said something was wrong",
      detail: d.message,
      fromThem: true,
      href: "/disputes",
    });
  }

  for (const d of deliveries) {
    entries.push({
      id: d.id,
      kind: "delivery",
      at: d.deliveredAt ?? d.createdAt,
      title: `Delivery ${d.number}${d.deliveredAt ? " signed for" : " sent"}`,
      href: `/delivery-notes/${d.id}`,
    });
  }

  for (const a of agreements) {
    entries.push({
      id: a.id,
      kind: "agreement",
      at: a.signedAt ?? a.createdAt,
      title: `${a.title}${a.signedAt ? " — signed" : ` — ${a.status.toLowerCase()}`}`,
      amountCents: a.valueCents,
      href: `/agreements/${a.id}`,
      fromThem: Boolean(a.signedAt),
    });
  }

  for (const n of notes) {
    entries.push({ id: n.id, kind: "note", at: n.createdAt, title: n.title || "Note", detail: n.body, href: "/notes" });
  }

  for (const c of calls) {
    const mins = c.durationSeconds ? Math.round(c.durationSeconds / 60) : null;
    entries.push({
      id: c.id,
      kind: "call",
      at: c.startedAt,
      title:
        c.status === "missed"
          ? `Missed call ${c.direction === "in" ? "from them" : "to them"}`
          : `${c.direction === "in" ? "Call from them" : "Called them"}${mins ? ` · ${mins} min` : ""}`,
      detail: c.summary,
      fromThem: c.direction === "in",
    });
  }

  for (const e of events) {
    entries.push({ id: e.id, kind: "event", at: e.createdAt, title: e.type.replace(/_/g, " ").toLowerCase(), detail: e.notes });
  }

  for (const l of leads) {
    entries.push({
      id: l.id,
      kind: "lead",
      at: l.createdAt,
      title: `Came in through ${l.form.title}`,
      detail: l.source ? `via ${l.source}` : null,
      fromThem: true,
      href: "/inbox",
    });
  }

  entries.sort((a, b) => when(b.at).getTime() - when(a.at).getTime());

  const invoiced = documents.filter((d) => d.type === "INVOICE" && d.status !== "DRAFT" && d.status !== "CANCELLED");
  const invoicedCents = invoiced.reduce((s, d) => s + d.amountCents, 0);
  const paidCents = documents
    .filter((d) => d.type === "PAYMENT")
    .reduce((s, d) => s + d.amountCents, 0);
  const refundedCents = documents.filter((d) => d.type === "REFUND").reduce((s, d) => s + d.amountCents, 0);

  const lastContact = entries[0]?.at ?? null;
  const conversations = new Set([...emailsIn, ...emailsOut].map((e) => ("subject" in e ? e.subject : ""))).size;

  return {
    partyId: party.id,
    customer: party.companyName ?? party.name,
    entries: entries.slice(0, opts.take ?? 200),
    summary: {
      firstSeen: party.createdAt,
      lastContact,
      quietForDays: lastContact ? Math.floor((now.getTime() - lastContact.getTime()) / 86_400_000) : null,
      invoicedCents,
      paidCents: paidCents - refundedCents,
      outstandingCents: Math.max(0, invoicedCents - (paidCents - refundedCents)),
      documents: invoiced.length + documents.filter((d) => d.type === "QUOTE" && d.status !== "DRAFT").length,
      conversations,
    },
  };
}
