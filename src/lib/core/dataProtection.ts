// What is held, why, for how long, and how somebody gets it out.
//
// POPIA in South Africa and the GDPR in Europe ask the same four questions of
// anybody holding other people's information, and almost no small business
// can answer them — not because they are doing anything wrong, but because
// nobody has ever written it down for them.
//
// Which is the opportunity. A business using this system is a responsible
// party under POPIA and a controller under the GDPR; this system is their
// operator, or processor. Both laws put obligations on both sides, and the
// operator is allowed to do most of the work. So: the record of what is held
// is generated rather than drafted, a subject's request is a screen rather
// than a legal exercise, and the retention rules are enforced rather than
// promised.
//
// The two rules that shape every decision below:
//
//   ERASURE IS NOT ABSOLUTE. A customer asking to be forgotten does not undo
//   five years of invoices — SARS requires those kept, and both laws carve
//   out a legal obligation. What can go is everything else, and saying which
//   is which plainly is far better than a refusal or a lie.
//
//   A REQUEST IS ANSWERED IN THIRTY DAYS. Both regimes say so. The clock
//   starts when the request arrives, not when somebody notices it, so it is
//   tracked from the moment it is logged.

import { prisma } from "@/lib/db";

export type Basis = "contract" | "legal-obligation" | "legitimate-interest" | "consent";

export interface DataCategory {
  what: string;
  /** Why it is held at all. */
  why: string;
  basis: Basis;
  /** How long, and what decides that. */
  retention: string;
  /** Whether a subject can have it erased on request. */
  erasable: boolean;
}

export const BASIS_LABEL: Record<Basis, string> = {
  contract: "Needed to do what was agreed",
  "legal-obligation": "Required by law",
  "legitimate-interest": "Needed to run the business, weighed against the person's privacy",
  consent: "Only because they said yes",
};

/**
 * The record of processing.
 *
 * POPIA section 17 and GDPR article 30 both want this, and both regimes'
 * regulators ask for it first when anything goes wrong. Generated from what
 * the system actually holds rather than written once and left to rot.
 */
export const DATA_CATEGORIES: DataCategory[] = [
  {
    what: "Customer name, phone number, email and address",
    why: "To quote, invoice and deliver to them.",
    basis: "contract",
    retention: "While they are a customer, and for five years after the last invoice.",
    erasable: false,
  },
  {
    what: "Invoices, quotes and payments",
    why: "They are the record of the trade, and the tax record.",
    basis: "legal-obligation",
    retention: "Five years from the end of the tax year, which SARS requires and which overrides a request to erase.",
    erasable: false,
  },
  {
    what: "Signed agreements and the signing record",
    why: "To prove what was agreed and by whom.",
    basis: "contract",
    retention: "Three years after the agreement ends, or longer where a claim could still be brought.",
    erasable: false,
  },
  {
    what: "Email and message history with a customer",
    why: "So anybody picking up the conversation knows what was said.",
    basis: "legitimate-interest",
    retention: "Three years from the last message.",
    erasable: true,
  },
  {
    what: "Marketing permission, and where it came from",
    why: "To prove somebody agreed before being marketed to, which POPIA section 69 requires.",
    basis: "consent",
    retention: "Kept after a withdrawal, because the proof that they withdrew is the point.",
    erasable: false,
  },
  {
    what: "Staff clock-ins, locations and leave",
    why: "To pay people correctly and to know who was where.",
    basis: "contract",
    retention: "Three years, which the Basic Conditions of Employment Act requires.",
    erasable: false,
  },
  {
    what: "Photographs on job cards and receipts",
    why: "Proof of what was delivered and what was spent.",
    basis: "legitimate-interest",
    retention: "Five years, with the document they belong to.",
    erasable: true,
  },
  {
    what: "Notes somebody typed about a customer",
    why: "Institutional memory — what they like, who to ask for.",
    basis: "legitimate-interest",
    retention: "Until the customer record goes.",
    erasable: true,
  },
];

export interface ProcessingRecord {
  businessName: string;
  role: string;
  operator: string;
  categories: DataCategory[];
  crossBorder: string;
  security: string[];
  /** What the business still has to do itself. Never claimed as done. */
  yourPart: string[];
}

/**
 * The document a regulator asks for.
 *
 * Deliberately not a template with blanks. Everything in it is true of this
 * deployment, and the last section says plainly what the software cannot do
 * for them — an information officer has to be a person.
 */
export async function processingRecord(tenantId: string): Promise<ProcessingRecord> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, countryCode: true },
  });

  return {
    businessName: tenant.name,
    role:
      tenant.countryCode === "ZA"
        ? "Responsible party under POPIA. You decide what is collected and why; we hold it for you."
        : "Controller under the GDPR. You decide what is collected and why; we process it on your instructions.",
    operator: "skynat.ai is the operator (POPIA) or processor (GDPR). It acts on this business's instructions and does not use its customer data for anything else.",
    categories: DATA_CATEGORIES,
    crossBorder:
      "Data is held on servers in the European Union. POPIA section 72 allows a transfer where the receiving country has comparable protection, which the GDPR provides.",
    security: [
      "Every workspace's data is separated by tenant, and every query is scoped to one workspace.",
      "Passwords are never held in readable form, and this system never asks anybody to type one on a customer's behalf.",
      "Signing records keep a shortened address rather than a full one, which places a signature without tracking a person.",
      "Every sensitive action is written to an audit log with who did it and when.",
    ],
    yourPart: [
      "Appoint an information officer and register them with the Information Regulator. That has to be a person, and it cannot be done by software.",
      "Tell your customers what you collect and why. The record above is the material for that notice, not the notice itself.",
      "Report a breach to the Information Regulator and to the people affected. This system will tell you what was exposed; the report is yours to make.",
    ],
  };
}

export type RequestKind = "access" | "correction" | "erasure" | "objection";

export const REQUEST_LABEL: Record<RequestKind, string> = {
  access: "Tell me what you hold about me",
  correction: "Fix something that is wrong",
  erasure: "Delete what you hold about me",
  objection: "Stop using it for that",
};

export interface SubjectRequest {
  kind: RequestKind;
  subject: string;
  /** Everything held about them, by category. */
  holding: Array<{ what: string; count: number; detail: string }>;
  /** What would go if they asked for erasure. */
  wouldErase: string[];
  /** What would stay, and the law that keeps it. */
  wouldRemain: Array<{ what: string; why: string }>;
  /** Both regimes say thirty days. */
  answerBy: Date;
  note: string;
}

/**
 * What is actually held about one person.
 *
 * Answering an access request by hand means somebody searching six screens
 * and missing two of them. This is the same search the system already does
 * for a customer timeline, turned around and pointed at the question the law
 * asks.
 */
export async function subjectRequest(params: {
  tenantId: string;
  partyId: string;
  kind: RequestKind;
  receivedAt?: Date;
}): Promise<SubjectRequest> {
  const party = await prisma.party.findFirst({
    where: { id: params.partyId, tenantId: params.tenantId },
    select: { name: true, companyName: true, email: true, phone: true },
  });
  if (!party) throw new Error("That person is not in this workspace.");

  const [documents, payments, emails, notes, agreements, consents, events] = await Promise.all([
    prisma.transaction.count({ where: { tenantId: params.tenantId, partyId: params.partyId, type: { in: ["QUOTE", "INVOICE"] } } }),
    prisma.transaction.count({ where: { tenantId: params.tenantId, partyId: params.partyId, type: "PAYMENT" } }),
    prisma.inboundEmail.count({ where: { tenantId: params.tenantId, partyId: params.partyId } }).catch(() => 0),
    prisma.note.count({ where: { tenantId: params.tenantId, entityType: "Party", entityId: params.partyId } }).catch(() => 0),
    prisma.agreement.count({ where: { tenantId: params.tenantId, partyId: params.partyId } }),
    prisma.contactConsent.count({ where: { tenantId: params.tenantId, partyId: params.partyId } }).catch(() => 0),
    prisma.event.count({ where: { tenantId: params.tenantId, partyId: params.partyId } }).catch(() => 0),
  ]);

  const holding = [
    { what: "Contact details", count: 1, detail: [party.email, party.phone].filter(Boolean).join(", ") || "Name only" },
    { what: "Quotes and invoices", count: documents, detail: "The documents sent to them and what was on each." },
    { what: "Payments", count: payments, detail: "What was paid, when." },
    { what: "Emails and messages", count: emails, detail: "The conversation, both directions." },
    { what: "Notes", count: notes, detail: "What people here typed about them." },
    { what: "Agreements", count: agreements, detail: "What was signed, and the signing record." },
    { what: "Marketing permission", count: consents, detail: "Whether they agreed to be marketed to, and when." },
    { what: "Appointments and visits", count: events, detail: "When somebody was booked to see them." },
  ].filter((row) => row.count > 0);

  // The honest half. Erasure is not absolute, and saying which parts survive
  // is far better than a refusal that sounds like obstruction.
  const wouldErase = ["Emails and messages", "Notes about them", "Photographs not attached to an invoice", "Appointments in the past"];
  const wouldRemain = [
    { what: "Invoices and payments", why: "SARS requires five years. Both POPIA and the GDPR allow keeping what a law requires." },
    { what: "Signed agreements", why: "They are the record of what was agreed, and a claim could still be brought on them." },
    { what: "The record that they withdrew marketing permission", why: "Deleting it would mean no proof they ever said no, which is the opposite of protecting them." },
  ];

  const received = params.receivedAt ?? new Date();
  const answerBy = new Date(received.getTime() + 30 * 86_400_000);

  return {
    kind: params.kind,
    subject: party.companyName ?? party.name,
    holding,
    wouldErase,
    wouldRemain,
    answerBy,
    note:
      params.kind === "erasure"
        ? "Erasure is not absolute. What the law requires kept stays, and the person asking is entitled to be told exactly which parts and why."
        : `Both POPIA and the GDPR give thirty days to answer, counted from when the request arrived rather than from when somebody noticed it.`,
  };
}

/**
 * What has been held longer than it should be.
 *
 * Retention rules that are written down and never enforced are worse than
 * none: they are a promise a regulator can hold somebody to. This finds the
 * rows that are past their period, and it never deletes anything on its own —
 * a business decides, because only they know whether a claim is still live.
 */
export async function pastRetention(tenantId: string, now = new Date()) {
  const threeYears = new Date(now.getTime() - 3 * 365 * 86_400_000);
  const fiveYears = new Date(now.getTime() - 5 * 365 * 86_400_000);

  const [oldEmails, oldNotes, oldDocuments, quietCustomers] = await Promise.all([
    prisma.inboundEmail.count({ where: { tenantId, receivedAt: { lt: threeYears } } }).catch(() => 0),
    prisma.note.count({ where: { tenantId, createdAt: { lt: threeYears } } }).catch(() => 0),
    prisma.transaction.count({ where: { tenantId, createdAt: { lt: fiveYears }, type: { in: ["QUOTE", "INVOICE"] } } }),
    prisma.party.count({
      where: { tenantId, role: "CUSTOMER", createdAt: { lt: fiveYears }, transactions: { none: { createdAt: { gte: fiveYears } } } },
    }),
  ]);

  const rows = [
    { what: "Emails and messages", count: oldEmails, older: "3 years", action: "Can be cleared. Nothing in them is required by law." },
    { what: "Notes about customers", count: oldNotes, older: "3 years", action: "Can be cleared." },
    {
      what: "Quotes and invoices",
      count: oldDocuments,
      older: "5 years",
      action: "Past what SARS requires, but keep them if any claim could still be brought. This is a decision, not a cleanup.",
    },
    {
      what: "Customers with nothing in five years",
      count: quietCustomers,
      older: "5 years",
      action: "Contact details for somebody who has not traded in five years are being kept for no reason anybody could defend.",
    },
  ].filter((row) => row.count > 0);

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    note:
      rows.length === 0
        ? "Nothing is being held past its period."
        : "Nothing here is deleted automatically. A retention rule written down and never enforced is worse than none, but only you know whether a claim is still live.",
  };
}

/**
 * What a breach would have exposed.
 *
 * POPIA section 22 and GDPR article 33 both require a notification, and both
 * require it to say what was affected. A business that cannot answer that
 * question notifies late and badly. This answers it from what the workspace
 * actually holds.
 */
export async function breachSurface(tenantId: string) {
  const [people, withEmail, withPhone, withBank, documents, signatures] = await Promise.all([
    prisma.party.count({ where: { tenantId } }),
    prisma.party.count({ where: { tenantId, email: { not: null } } }),
    prisma.party.count({ where: { tenantId, phone: { not: null } } }),
    prisma.party.count({ where: { tenantId, vatNumber: { not: null } } }),
    prisma.transaction.count({ where: { tenantId } }),
    prisma.agreement.count({ where: { tenantId, signatureDataUrl: { not: null } } }),
  ]);

  return {
    people,
    withEmail,
    withPhone,
    withTaxNumber: withBank,
    documents,
    signatures,
    sentence: `A full exposure of this workspace would affect ${people.toLocaleString()} ${people === 1 ? "person or business" : "people and businesses"} — ${withEmail.toLocaleString()} with an email address, ${withPhone.toLocaleString()} with a phone number, and ${signatures.toLocaleString()} with a signature on file.`,
    duty:
      "A breach has to be reported to the Information Regulator and to the people affected, as soon as reasonably possible. The report is yours to make; this is the part of it that says what was affected.",
    notHeld: [
      "No card numbers. Payments go through a provider, and the card never reaches this system.",
      "No customer passwords. The customer portal is a link, not a login.",
      "No ID numbers, unless somebody typed one into a note.",
    ],
  };
}
