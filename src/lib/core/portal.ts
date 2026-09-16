// The customer's side.
//
// Most portals in this category are a read-only list of PDFs, which is why
// nobody uses them: the three things a customer actually wants to do are send
// the proof of payment they just made, ask what an invoice is for, and fix
// the address that keeps coming out wrong. All three land here as something a
// person answers — nothing a customer sends changes the books by itself.
//
// Everything is scoped by the token to one Party. A token is the whole
// credential, so every read and write goes through resolvePortal() and
// nothing takes a partyId from the request.

import { prisma } from "@/lib/db";
import { customerBalances, netPaidByInvoice } from "./money";
import { createNotification } from "./notifications2";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface PortalDocument {
  id: string;
  kind: "QUOTE" | "INVOICE";
  number: string;
  status: string;
  issuedAt: Date;
  dueAt: Date | null;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  subject: string | null;
}

export interface PortalOverview {
  token: string;
  party: { id: string; name: string; companyName: string | null; email: string | null; phone: string | null; addressLine: string | null; vatNumber: string | null };
  business: { id: string; name: string; email: string | null; phone: string | null; address: string | null; currency: string; logoDataUrl: string | null; bankName: string | null; bankAccountNumber: string | null; bankBranchCode: string | null; bankAccountHolder: string | null };
  documents: PortalDocument[];
  balanceCents: number;
  overdueCents: number;
  deliveries: Array<{ id: string; number: string; status: string; createdAt: Date; deliveredAt: Date | null; lines: number }>;
  submissions: Array<{ id: string; kind: string; body: string | null; createdAt: Date; handledAt: Date | null }>;
}

/** The party a token belongs to, or nothing. Every portal read starts here. */
export async function resolvePortal(token: string) {
  if (!token || token.length < 16) return null;
  const party = await prisma.party.findUnique({ where: { portalToken: token } });
  return party ?? null;
}

export async function portalOverview(token: string): Promise<PortalOverview | null> {
  const party = await resolvePortal(token);
  if (!party) return null;

  const [tenant, template, transactions, deliveries, submissions, balances] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: party.tenantId } }),
    prisma.tenantPdfTemplate.findFirst({ where: { tenantId: party.tenantId, isDefault: true }, select: { logoDataUrl: true } }),
    prisma.transaction.findMany({
      where: { partyId: party.id, type: { in: ["QUOTE", "INVOICE"] }, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, type: true, status: true, createdAt: true, dueAt: true, amountCents: true, subject: true, externalRef: true },
    }),
    prisma.deliveryNote.findMany({
      where: { tenantId: party.tenantId, partyId: party.id, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, number: true, status: true, createdAt: true, deliveredAt: true, lines: { select: { id: true } } },
    }),
    prisma.portalSubmission.findMany({
      where: { tenantId: party.tenantId, partyId: party.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, body: true, createdAt: true, handledAt: true },
    }),
    customerBalances(party.tenantId, party.id),
  ]);

  const paidByInvoice = await netPaidByInvoice(transactions.filter((t) => t.type === "INVOICE").map((t) => t.id));

  const now = new Date();
  let overdueCents = 0;
  const documents: PortalDocument[] = transactions.map((t) => {
    const paid = paidByInvoice.get(t.id) ?? 0;
    const outstanding = t.type === "INVOICE" && t.status !== "CANCELLED" ? Math.max(0, t.amountCents - paid) : 0;
    if (outstanding > 0 && t.dueAt && t.dueAt < now) overdueCents += outstanding;
    return {
      id: t.id,
      kind: t.type as "QUOTE" | "INVOICE",
      number: t.externalRef ?? `${t.type === "INVOICE" ? "INV" : "QT"}-${t.id.slice(-6).toUpperCase()}`,
      status: t.status,
      issuedAt: t.createdAt,
      dueAt: t.dueAt,
      amountCents: t.amountCents,
      paidCents: paid,
      outstandingCents: outstanding,
      subject: t.subject,
    };
  });

  return {
    token,
    party: {
      id: party.id,
      name: party.name,
      companyName: party.companyName,
      email: party.email,
      phone: party.phone,
      addressLine: party.addressLine,
      vatNumber: party.vatNumber,
    },
    business: {
      id: tenant.id,
      name: tenant.name,
      email: tenant.businessEmail,
      phone: tenant.businessPhone,
      address: tenant.businessAddress,
      currency: tenant.currency,
      logoDataUrl: template?.logoDataUrl ?? null,
      bankName: tenant.bankName,
      bankAccountNumber: tenant.bankAccountNumber,
      bankBranchCode: tenant.bankBranchCode,
      bankAccountHolder: tenant.bankAccountHolder,
    },
    documents,
    balanceCents: balances.get(party.id) ?? 0,
    overdueCents,
    deliveries: deliveries.map((d) => ({ ...d, lines: d.lines.length })),
    submissions,
  };
}

async function submit(params: {
  token: string;
  kind: "payment_proof" | "message" | "details";
  body?: string | null;
  transactionId?: string | null;
  fileName?: string | null;
  fileDataUrl?: string | null;
  notify: { title: string; type?: "PAYMENT_PROOF_RECEIVED" | "GENERAL" };
}) {
  const party = await resolvePortal(params.token);
  if (!party) throw new Error("That link is not valid any more.");

  if (params.fileDataUrl) {
    if (!/^data:(image\/(png|jpe?g|webp)|application\/pdf);base64,/.test(params.fileDataUrl)) {
      throw new Error("Send a photograph or a PDF.");
    }
    if (params.fileDataUrl.length > MAX_FILE_BYTES) throw new Error("That file is too big — send a photograph of it instead.");
  }

  // A document named by the customer has to be their own.
  let transactionId: string | null = null;
  if (params.transactionId) {
    const doc = await prisma.transaction.findFirst({
      where: { id: params.transactionId, tenantId: party.tenantId, partyId: party.id },
      select: { id: true },
    });
    transactionId = doc?.id ?? null;
  }

  const submission = await prisma.portalSubmission.create({
    data: {
      tenantId: party.tenantId,
      partyId: party.id,
      kind: params.kind,
      transactionId,
      body: params.body?.trim() || null,
      fileName: params.fileName ?? null,
      fileDataUrl: params.fileDataUrl ?? null,
    },
  });

  await createNotification({
    tenantId: party.tenantId,
    type: params.notify.type ?? "GENERAL",
    title: params.notify.title,
    body: `${party.name}${params.body ? `: ${params.body.slice(0, 200)}` : ""}`,
    linkHref: `/dashboard/${party.tenantId}/inbox`,
  });

  return submission;
}

/** "I have paid" — the thing every South African business is sent by WhatsApp. */
export async function submitPaymentProof(params: {
  token: string;
  transactionId?: string | null;
  note?: string | null;
  fileName?: string | null;
  fileDataUrl?: string | null;
}) {
  if (!params.fileDataUrl && !params.note?.trim()) throw new Error("Attach the proof, or say what you paid and when.");
  return submit({
    token: params.token,
    kind: "payment_proof",
    body: params.note ?? null,
    transactionId: params.transactionId ?? null,
    fileName: params.fileName ?? null,
    fileDataUrl: params.fileDataUrl ?? null,
    notify: { title: "A customer sent proof of payment", type: "PAYMENT_PROOF_RECEIVED" },
  });
}

export async function submitMessage(params: { token: string; body: string; transactionId?: string | null }) {
  if (!params.body?.trim()) throw new Error("There is nothing in the message.");
  return submit({
    token: params.token,
    kind: "message",
    body: params.body,
    transactionId: params.transactionId ?? null,
    notify: { title: "A customer asked something" },
  });
}

/**
 * The customer's own details, corrected by them — proposed, not applied. An
 * address that changes itself the day before an invoice goes out is how a
 * document ends up wrong in a way nobody can explain.
 */
export async function submitDetails(params: {
  token: string;
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  addressLine?: string;
  vatNumber?: string;
}) {
  const party = await resolvePortal(params.token);
  if (!party) throw new Error("That link is not valid any more.");

  const changes = (["name", "companyName", "email", "phone", "addressLine", "vatNumber"] as const)
    .map((field) => ({ field, was: party[field] ?? "", now: (params[field] ?? "").trim() }))
    .filter((c) => c.now && c.now !== c.was);
  if (changes.length === 0) throw new Error("Nothing was changed.");

  return submit({
    token: params.token,
    kind: "details",
    body: changes.map((c) => `${c.field}: ${c.was || "(blank)"} → ${c.now}`).join("\n"),
    notify: { title: "A customer corrected their details" },
  });
}

/** What customers have sent in, for the business to answer. */
export async function listSubmissions(tenantId: string, opts: { handled?: boolean; take?: number } = {}) {
  return prisma.portalSubmission.findMany({
    where: { tenantId, ...(opts.handled === undefined ? {} : opts.handled ? { handledAt: { not: null } } : { handledAt: null }) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    include: { party: { select: { id: true, name: true } }, transaction: { select: { id: true, type: true, amountCents: true } } },
  });
}

export async function markSubmissionHandled(tenantId: string, submissionId: string, membershipId?: string | null) {
  const submission = await prisma.portalSubmission.findFirst({ where: { id: submissionId, tenantId }, select: { id: true } });
  if (!submission) throw new Error("That is not in this workspace.");
  return prisma.portalSubmission.update({
    where: { id: submissionId },
    data: { handledAt: new Date(), handledById: membershipId ?? null },
  });
}

/** Apply a details correction the business has looked at and accepted. */
export async function acceptDetails(tenantId: string, submissionId: string, membershipId?: string | null) {
  const submission = await prisma.portalSubmission.findFirst({
    where: { id: submissionId, tenantId, kind: "details" },
    select: { id: true, partyId: true, body: true },
  });
  if (!submission?.body) throw new Error("That correction is not in this workspace.");

  const data: Record<string, string> = {};
  for (const line of submission.body.split("\n")) {
    const [field, rest] = line.split(":");
    const now = rest?.split("→").pop()?.trim();
    if (field && now && ["name", "companyName", "email", "phone", "addressLine", "vatNumber"].includes(field.trim())) {
      data[field.trim()] = now;
    }
  }
  if (Object.keys(data).length > 0) await prisma.party.update({ where: { id: submission.partyId }, data });
  await markSubmissionHandled(tenantId, submissionId, membershipId);
  return { applied: Object.keys(data).length };
}
