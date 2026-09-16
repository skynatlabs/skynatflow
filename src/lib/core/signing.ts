// Signing, and being able to prove it later.
//
// A drawn signature on a screen is not the hard part. The hard part is the
// eighteen-months-later conversation: who signed, when, from where, and was
// the document they saw the same one you are holding now. Every commercial
// e-signature product sells exactly one thing, and it is that page at the
// back — the certificate that turns a picture of a name into evidence.
//
// So this is the audit trail for anything signable, kept as ordinary audit
// rows rather than a new table, and read back as a certificate. Two kinds of
// document are signable today — an agreement and a quote — and the shape is
// general because the third one always arrives.
//
// What it is honest about: this is a record kept by the business's own
// system, not a notarised one. That is worth a great deal in a commercial
// dispute and is not the same as a qualified electronic signature under the
// EU's eIDAS or South Africa's ECT Act section 37. The certificate says so,
// because a document that overclaims is worse than one that does not claim.

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { acceptanceHashFor, parseClauses } from "./agreements";

export type SignableKind = "agreement" | "quote";

/** The things that happen to a document on its way to being signed. */
export type SigningEvent = "prepared" | "sent" | "opened" | "signed" | "declined";

const CAPABILITY: Record<SigningEvent, string> = {
  prepared: "document:prepare",
  sent: "document:send",
  opened: "document:open",
  signed: "document:sign",
  declined: "document:decline",
};

const TARGET: Record<SignableKind, string> = {
  agreement: "Agreement",
  quote: "Transaction",
};

/**
 * Note something that happened to a signable document.
 *
 * Deliberately never throws into the caller's path: an unrecorded audit line
 * is a gap in the certificate, but a signing flow that falls over because the
 * audit write failed is a customer who cannot sign at all.
 */
export async function noteSigningEvent(params: {
  tenantId: string;
  kind: SignableKind;
  documentId: string;
  event: SigningEvent;
  /** Who, as far as we can tell. A customer signing through a portal link is not a user. */
  actor?: { type: "user" | "ai" | "system"; id?: string; name?: string };
  ip?: string;
  userAgent?: string;
  note?: string;
}) {
  try {
    // Written straight to the audit table rather than through recordAudit,
    // because a signing event is not one of the role capabilities that
    // function's type guards — a customer signing through a portal link has
    // no role in this workspace at all.
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        actorType: params.actor?.type ?? "system",
        actorId: params.actor?.id,
        capability: CAPABILITY[params.event],
        targetType: TARGET[params.kind],
        targetId: params.documentId,
        metadata: JSON.stringify({
          event: params.event,
          name: params.actor?.name,
          // The last two octets are dropped. Knowing the signature came from
          // a Johannesburg connection is evidence; keeping a full address on
          // file for years is somebody's personal data with no purpose.
          ip: params.ip ? maskIp(params.ip) : undefined,
          device: params.userAgent ? shortDevice(params.userAgent) : undefined,
          note: params.note,
        }),
      },
    });
  } catch {
    // Swallowed on purpose — see above.
  }
}

/** Enough to place a signature, not enough to track somebody. */
export function maskIp(ip: string): string {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}:…`;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return "unknown";
  return `${parts[0]}.${parts[1]}.x.x`;
}

/** "Chrome on Android" rather than ninety characters of version string. */
export function shortDevice(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "a browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "a Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : "an unknown device";
  return `${browser} on ${platform}`;
}

export interface CertificateLine {
  at: Date;
  what: string;
  who: string;
  where: string | null;
  device: string | null;
}

export interface SigningCertificate {
  kind: SignableKind;
  documentId: string;
  reference: string;
  title: string;
  customer: string;
  valueCents: number | null;
  signedAt: Date | null;
  signerName: string | null;
  /** The fingerprint taken at signature. */
  hash: string | null;
  /** Recomputed now. If these differ the document has been edited since. */
  hashNow: string | null;
  intact: boolean;
  history: CertificateLine[];
  /** What this certificate does and does not prove, in plain language. */
  standing: string[];
}

const WORDING: Record<SigningEvent, string> = {
  prepared: "Document created",
  sent: "Sent to the customer",
  opened: "Opened by the customer",
  signed: "Signed",
  declined: "Declined",
};

/**
 * The page at the back.
 *
 * Reads the audit trail and the document itself, recomputes the fingerprint,
 * and says whether the two still agree. A mismatch is not hidden behind a
 * warning icon — an edited signed document is the single most important thing
 * this page can tell somebody.
 */
export async function signingCertificate(params: {
  tenantId: string;
  kind: SignableKind;
  documentId: string;
}): Promise<SigningCertificate | null> {
  const trail = await prisma.auditLog.findMany({
    where: { tenantId: params.tenantId, targetType: TARGET[params.kind], targetId: params.documentId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const history: CertificateLine[] = trail.map((row) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    const event = String(meta.event ?? "") as SigningEvent;
    return {
      at: row.createdAt,
      what: WORDING[event] ?? row.capability,
      who: String(meta.name ?? (row.actorType === "system" ? "the system" : row.actorType === "ai" ? "an agent" : "a person")),
      where: meta.ip ? String(meta.ip) : null,
      device: meta.device ? String(meta.device) : null,
    };
  });

  const standing = [
    "This record is kept by the business's own system. It shows what happened and when, and that the document has not been altered since it was signed.",
    "It is not a notarised or qualified electronic signature. Where a law requires one of those — for a will, or the sale of land — this is not a substitute.",
  ];

  if (params.kind === "agreement") {
    const agreement = await prisma.agreement.findFirst({
      where: { id: params.documentId, tenantId: params.tenantId },
      include: { party: { select: { name: true, companyName: true } } },
    });
    if (!agreement) return null;

    const clauses = parseClauses(agreement.clauses);
    const hashNow =
      agreement.signedAt && agreement.signerName
        ? acceptanceHashFor({
            clauses,
            valueCents: agreement.valueCents,
            signerName: agreement.signerName,
            signedAt: agreement.signedAt,
          })
        : null;

    return {
      kind: "agreement",
      documentId: agreement.id,
      reference: agreement.number,
      title: agreement.title,
      customer: agreement.party.companyName ?? agreement.party.name,
      valueCents: agreement.valueCents,
      signedAt: agreement.signedAt,
      signerName: agreement.signerName,
      hash: agreement.acceptanceHash,
      hashNow,
      intact: !agreement.acceptanceHash || agreement.acceptanceHash === hashNow,
      history,
      standing,
    };
  }

  const quote = await prisma.transaction.findFirst({
    where: { id: params.documentId, tenantId: params.tenantId },
    include: {
      party: { select: { name: true, companyName: true } },
      itemLines: { select: { quantity: true, unitPriceCents: true, discountPercent: true, description: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) return null;

  const hashNow = quote.respondedAt ? quoteFingerprint(quote) : null;

  return {
    kind: "quote",
    documentId: quote.id,
    reference: quote.externalRef ?? `Q-${quote.id.slice(-6).toUpperCase()}`,
    title: quote.subject ?? "Quote",
    customer: quote.party.companyName ?? quote.party.name,
    valueCents: quote.amountCents,
    signedAt: quote.respondedAt,
    signerName: quote.signatureDataUrl ? (quote.party.companyName ?? quote.party.name) : null,
    hash: quote.acceptanceHash,
    hashNow,
    intact: !quote.acceptanceHash || quote.acceptanceHash === hashNow,
    history,
    standing,
  };
}

/** The same binding an agreement gets: lines, total and the moment, as one fingerprint. */
export function quoteFingerprint(quote: {
  amountCents: number;
  respondedAt: Date | null;
  itemLines: Array<{ quantity: number; unitPriceCents: number; discountPercent: number | null; description: string | null }>;
}): string {
  const body = [
    String(quote.amountCents),
    quote.respondedAt?.toISOString() ?? "",
    ...quote.itemLines.map((l) => `${l.description ?? ""}|${l.quantity}|${l.unitPriceCents}|${l.discountPercent ?? 0}`),
  ].join("\n");
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Everything waiting on somebody's signature, oldest first.
 *
 * The ones sent longest ago are the ones that have quietly died, which is why
 * this is ordered the way it is rather than newest first like every other
 * list in the product.
 */
export async function awaitingSignature(tenantId: string, now = new Date()) {
  const [agreements, quotes] = await Promise.all([
    prisma.agreement.findMany({
      where: { tenantId, status: "SENT", signedAt: null, declinedAt: null },
      orderBy: { sentAt: "asc" },
      include: { party: { select: { name: true, companyName: true } } },
      take: 100,
    }),
    prisma.transaction.findMany({
      where: { tenantId, type: "QUOTE", status: "SENT", signatureDataUrl: null },
      orderBy: { createdAt: "asc" },
      include: { party: { select: { name: true, companyName: true } } },
      take: 100,
    }),
  ]);

  const rows = [
    ...agreements.map((a) => ({
      kind: "agreement" as const,
      id: a.id,
      reference: a.number,
      title: a.title,
      customer: a.party.companyName ?? a.party.name,
      valueCents: a.valueCents,
      sentAt: a.sentAt ?? a.createdAt,
    })),
    ...quotes.map((q) => ({
      kind: "quote" as const,
      id: q.id,
      reference: q.externalRef ?? `Q-${q.id.slice(-6).toUpperCase()}`,
      title: q.subject ?? "Quote",
      customer: q.party.companyName ?? q.party.name,
      valueCents: q.amountCents,
      sentAt: q.createdAt,
    })),
  ].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  return rows.map((row) => {
    const days = Math.floor((now.getTime() - row.sentAt.getTime()) / 86_400_000);
    return {
      ...row,
      waitingDays: days,
      note:
        days >= 21
          ? "Three weeks with no answer. This one is usually a no that nobody said out loud."
          : days >= 7
            ? "A week out. Worth a call rather than another email."
            : "Recently sent.",
    };
  });
}
