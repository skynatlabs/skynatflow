// Proposals and contracts.
//
// A quote is a price. The document that actually wins the work — and the one
// that settles the argument eighteen months later — is prose: what is being
// done, by when, what it costs, who owns what, and what happens when somebody
// stops paying. Every small business writes these in Word, keeps them in a
// folder called "docs final v3", and cannot tell you which ones are signed.
//
// So: a first-class document with a number, a state, a customer, a value, a
// library of starting points, and a signature captured through the same
// portal link the customer already has. The clauses are ordered prose rather
// than a field per term, because a maintenance retainer and a sub-contract
// share almost no fields, and every attempt to model them as one shape ends
// as a form nobody can fill in.
//
// What is deliberately not here: legal advice. The library is plain-language
// commercial wording that gives an owner something to edit instead of a blank
// page. Every template says so, in the document.

import { createHash } from "crypto";
import { AgreementKind, AgreementState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export interface Clause {
  heading: string;
  body: string;
}

export interface AgreementTemplate {
  key: string;
  kind: AgreementKind;
  label: string;
  /** What this is for, in the words of somebody choosing it. */
  purpose: string;
  /** Sensible default title, with {customer} filled in. */
  title: string;
  /** Whether a value and a term are part of this document at all. */
  wantsValue: boolean;
  wantsTerm: boolean;
  clauses: Clause[];
}

/** Placeholders the library uses, filled the moment a document is made. */
export interface AgreementFacts {
  business: string;
  customer: string;
  value?: string;
  recurrence?: string;
  starts?: string;
  ends?: string;
  months?: number;
}

const PAYMENT_TERMS: Clause = {
  heading: "Payment",
  body:
    "Invoices are payable within 30 days of the invoice date, by electronic transfer to the account shown on the " +
    "invoice. Where an amount is disputed, {customer} will pay the undisputed part on time and raise the rest in " +
    "writing within 7 days of receiving the invoice. Interest on an overdue amount runs at 2% a month from the due " +
    "date until it is paid.",
};

const CHANGES: Clause = {
  heading: "Changes to the work",
  body:
    "Either party may ask for a change. A change that affects the price or the dates takes effect only once both " +
    "parties have confirmed it in writing — an email is enough. Work already done at the time of a change is " +
    "payable whether or not the change goes ahead.",
};

const ENDING: Clause = {
  heading: "Ending this agreement",
  body:
    "Either party may end this agreement on 30 days' written notice. {business} will be paid for everything done up " +
    "to the last day. Either party may end it immediately if the other is placed under business rescue or " +
    "liquidation, or fails to fix a material breach within 14 days of being told about it in writing.",
};

const CONFIDENTIALITY: Clause = {
  heading: "Confidentiality",
  body:
    "Each party will keep the other's commercial information confidential, use it only for this work, and return or " +
    "destroy it when asked. This does not cover information that is already public, or that a party is required by " +
    "law to disclose.",
};

const DISPUTES: Clause = {
  heading: "If something goes wrong",
  body:
    "The parties will first try to settle any dispute by talking, between people with the authority to settle it. " +
    "Failing that, the dispute goes to mediation before either party goes to court. This agreement is governed by " +
    "South African law.",
};

const WHOLE: Clause = {
  heading: "The whole agreement",
  body:
    "This document is the whole agreement between {business} and {customer} on this work, and replaces anything said " +
    "or written before it. A change to it is only binding once both parties have signed it.",
};

export const AGREEMENT_TEMPLATES: AgreementTemplate[] = [
  {
    key: "proposal",
    kind: AgreementKind.PROPOSAL,
    label: "Business proposal",
    purpose: "Win the work. What you understand the problem to be, what you will do about it, and what it costs.",
    title: "Proposal for {customer}",
    wantsValue: true,
    wantsTerm: false,
    clauses: [
      {
        heading: "What we understand",
        body:
          "Write here, in your own words, what {customer} has told you they need — the problem as they described it, " +
          "not as you would describe it. A proposal that repeats the customer's own words back to them wins more work " +
          "than one that opens with your company history.",
      },
      {
        heading: "What we propose",
        body: "What you will actually do. Be specific enough that somebody who was not in the meeting could check it later.",
      },
      {
        heading: "What it costs",
        body: "{value}. This is valid for 30 days from the date of this proposal.",
      },
      {
        heading: "How long it takes",
        body: "When you can start, and how long the work takes once started. Say what you are waiting on from {customer}.",
      },
      { heading: "Why us", body: "Two or three sentences. Similar work you have done, and who to call about it." },
      {
        heading: "What happens next",
        body:
          "Sign this proposal at the link you were sent and we will confirm a start date within two working days. " +
          "Any questions, reply to this and we will come back to you.",
      },
    ],
  },
  {
    key: "service",
    kind: AgreementKind.SERVICE,
    label: "Service agreement",
    purpose: "Work done over time for one customer — installation, consulting, a project with stages.",
    title: "Service agreement between {business} and {customer}",
    wantsValue: true,
    wantsTerm: true,
    clauses: [
      {
        heading: "The parties",
        body: "This agreement is between {business} and {customer}, and starts on {starts}.",
      },
      {
        heading: "The work",
        body: "Describe exactly what {business} will do. Anything not written here is not included.",
      },
      {
        heading: "What is not included",
        body:
          "The list that prevents the argument. Anything outside the work above is quoted separately before it is done.",
      },
      { heading: "The price", body: "{value}." },
      PAYMENT_TERMS,
      {
        heading: "What we need from you",
        body:
          "Access to the site during agreed hours, a contact person who can make decisions, and anything else the work " +
          "depends on. Delays caused by these not being in place move the dates, and any standing time is chargeable.",
      },
      CHANGES,
      {
        heading: "Standard of work",
        body:
          "{business} will do this work with reasonable skill and care, using people competent to do it, and will fix " +
          "any defect reported within 90 days of completion at no charge, unless the defect was caused by misuse or by " +
          "somebody else's work.",
      },
      ENDING,
      DISPUTES,
      WHOLE,
    ],
  },
  {
    key: "retainer",
    kind: AgreementKind.RETAINER,
    label: "Retainer or maintenance",
    purpose: "The same thing every month for a fixed fee — support, maintenance, a service plan.",
    title: "Maintenance agreement between {business} and {customer}",
    wantsValue: true,
    wantsTerm: true,
    clauses: [
      { heading: "The parties", body: "This agreement is between {business} and {customer}, and runs from {starts} to {ends}." },
      {
        heading: "What is covered",
        body:
          "List what the monthly fee covers — visits, hours, response times, parts. Be specific about how many and how " +
          "quickly; \"support\" on its own is what makes a retainer unprofitable.",
      },
      {
        heading: "What is not covered",
        body:
          "Work outside the cover above is quoted separately and done only once approved. Consumables and parts are " +
          "charged at cost plus the agreed markup unless stated otherwise.",
      },
      { heading: "The fee", body: "{value}, invoiced in advance, starting {starts}." },
      PAYMENT_TERMS,
      {
        heading: "Suspending the service",
        body:
          "If an invoice is more than 30 days overdue, {business} may suspend the service on 7 days' written notice " +
          "until it is settled. Suspension does not reduce the fee for the period.",
      },
      {
        heading: "Term and renewal",
        body:
          "This agreement runs until {ends} and then continues month to month unless either party gives 30 days' " +
          "written notice. The fee may be reviewed once a year, on 60 days' written notice.",
      },
      DISPUTES,
      WHOLE,
    ],
  },
  {
    key: "supply",
    kind: AgreementKind.SUPPLY,
    label: "Supply agreement",
    purpose: "Selling goods to a business customer regularly — pricing, delivery, ownership, returns.",
    title: "Supply agreement between {business} and {customer}",
    wantsValue: false,
    wantsTerm: true,
    clauses: [
      { heading: "The parties", body: "This agreement is between {business} and {customer}, and starts on {starts}." },
      {
        heading: "What is supplied",
        body: "The goods covered, and how they are ordered. A price list attached to this agreement forms part of it.",
      },
      {
        heading: "Prices",
        body:
          "Prices are those on the current price list and may be changed on 30 days' written notice. An order already " +
          "accepted is supplied at the price when it was accepted.",
      },
      PAYMENT_TERMS,
      {
        heading: "Delivery and risk",
        body:
          "Delivery is to the address on the order. Risk passes on delivery; ownership passes only once the goods are " +
          "paid for in full. Until then {customer} holds them for {business} and will not pledge them as security.",
      },
      {
        heading: "Shortages and damage",
        body:
          "Shortages or visible damage must be noted on the delivery note at the time and reported in writing within " +
          "48 hours. Goods correctly supplied are returnable only by agreement and may carry a handling charge.",
      },
      {
        heading: "Credit",
        body:
          "Any credit facility is granted at {business}'s discretion and may be reduced or withdrawn on written notice. " +
          "Orders beyond the limit are supplied on payment up front.",
      },
      ENDING,
      DISPUTES,
      WHOLE,
    ],
  },
  {
    key: "nda",
    kind: AgreementKind.NDA,
    label: "Non-disclosure agreement",
    purpose: "Before talking to somebody about something you would rather they did not repeat.",
    title: "Non-disclosure agreement between {business} and {customer}",
    wantsValue: false,
    wantsTerm: true,
    clauses: [
      { heading: "The parties", body: "This agreement is between {business} and {customer}, and starts on {starts}." },
      {
        heading: "Why",
        body: "The parties want to discuss a possible working relationship, and will share information to do it.",
      },
      {
        heading: "What is confidential",
        body:
          "Anything one party gives the other that is marked confidential, or that a reasonable person would treat as " +
          "confidential — including pricing, customer lists, methods, and anything about a business's finances.",
      },
      {
        heading: "What each party will do",
        body:
          "Use the information only to consider this relationship, keep it as carefully as its own confidential " +
          "information, share it only with people who need it and are bound by the same terms, and return or destroy " +
          "it on request.",
      },
      {
        heading: "What is not covered",
        body:
          "Information that is already public through no fault of the receiving party, that it already had, that it " +
          "develops on its own, or that it is required by law to disclose — having first told the other party where it " +
          "is allowed to.",
      },
      { heading: "How long", body: "These obligations last for three years from {starts}, whether or not anything comes of the discussions." },
      DISPUTES,
      WHOLE,
    ],
  },
  {
    key: "subcontract",
    kind: AgreementKind.SUBCONTRACT,
    label: "Sub-contract",
    purpose: "Putting another business on your job — what they do, what they carry, and when they get paid.",
    title: "Sub-contract between {business} and {customer}",
    wantsValue: true,
    wantsTerm: true,
    clauses: [
      {
        heading: "The parties",
        body:
          "This sub-contract is between {business} (the contractor) and {customer} (the sub-contractor), and starts on " +
          "{starts}.",
      },
      { heading: "The work", body: "Exactly what the sub-contractor is engaged to do, and on whose site." },
      { heading: "The price", body: "{value}, for the work described above." },
      {
        heading: "Payment",
        body:
          "The sub-contractor invoices monthly for work completed. Payment is within 30 days of the invoice, subject to " +
          "the work having been accepted. Retention, if any, is stated on each invoice and released on final acceptance.",
      },
      {
        heading: "Independent contractor",
        body:
          "The sub-contractor is an independent business, not an employee. It is responsible for its own people, their " +
          "pay, their statutory deductions, and their conduct on site.",
      },
      {
        heading: "Insurance and compliance",
        body:
          "The sub-contractor warrants that it carries public liability cover and is registered for COIDA, and will " +
          "produce a valid letter of good standing and its people's competence certificates on request.",
      },
      {
        heading: "Health and safety",
        body:
          "The sub-contractor will comply with the Occupational Health and Safety Act and with the site rules, and " +
          "will stop work and report immediately if conditions become unsafe.",
      },
      {
        heading: "No poaching and no approach",
        body:
          "During this sub-contract and for 12 months after it, the sub-contractor will not approach the end customer " +
          "directly for work of this kind, and neither party will employ the other's people without written consent.",
      },
      ENDING,
      CONFIDENTIALITY,
      DISPUTES,
      WHOLE,
    ],
  },
];

export const TEMPLATE_BY_KEY: Record<string, AgreementTemplate> = Object.fromEntries(
  AGREEMENT_TEMPLATES.map((t) => [t.key, t])
);

/** The one line every generated document carries, because it is true. */
export const NOT_LEGAL_ADVICE =
  "This document was drafted from a standard template and is not legal advice. Read it, change what does not fit, " +
  "and have anything unusual checked by an attorney before you sign it.";

export function fillClauses(clauses: Clause[], facts: AgreementFacts): Clause[] {
  const replace = (text: string) =>
    text
      .replaceAll("{business}", facts.business)
      .replaceAll("{customer}", facts.customer)
      .replaceAll("{value}", facts.value ?? "the amount agreed")
      .replaceAll("{starts}", facts.starts ?? "the date this is signed")
      .replaceAll("{ends}", facts.ends ?? "the end of the term");
  return clauses.map((c) => ({ heading: replace(c.heading), body: replace(c.body) }));
}

/** Prose in, prose out — anything shaped wrong is dropped rather than shown. */
export function parseClauses(raw: Prisma.JsonValue | null | undefined): Clause[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const heading = (entry as Record<string, unknown>).heading;
    const body = (entry as Record<string, unknown>).body;
    if (typeof heading !== "string" || typeof body !== "string") return [];
    return [{ heading, body }];
  });
}

export async function nextAgreementNumber(tenantId: string): Promise<string> {
  const last = await prisma.agreement.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.replace(/\D/g, "")) + 1 : 1;
  return `AG-${String(n).padStart(4, "0")}`;
}

function money(cents: number | null | undefined, currency: string, recurrence?: string | null): string | undefined {
  if (cents === null || cents === undefined) return undefined;
  const amount = formatMoney(cents, currency, { decimals: true });
  switch (recurrence) {
    case "monthly":
      return `${amount} a month`;
    case "quarterly":
      return `${amount} a quarter`;
    case "annually":
      return `${amount} a year`;
    default:
      return amount;
  }
}

function asDate(d: Date | null | undefined): string | undefined {
  return d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : undefined;
}

export async function createAgreement(params: {
  tenantId: string;
  partyId: string;
  /** A key from the library, or nothing for a blank document. */
  templateKey?: string | null;
  kind?: AgreementKind;
  title?: string;
  clauses?: Clause[];
  valueCents?: number | null;
  recurrence?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  validUntil?: Date | null;
  transactionId?: string | null;
  createdById?: string | null;
}) {
  const [party, tenant] = await Promise.all([
    prisma.party.findFirst({ where: { id: params.partyId, tenantId: params.tenantId } }),
    prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true, currency: true } }),
  ]);
  if (!party) throw new Error("That customer is not in this workspace.");

  // A document named against a quote has to be a quote in this workspace.
  let transactionId: string | null = null;
  if (params.transactionId) {
    const doc = await prisma.transaction.findFirst({
      where: { id: params.transactionId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!doc) throw new Error("That document is not in this workspace.");
    transactionId = doc.id;
  }

  const template = params.templateKey ? TEMPLATE_BY_KEY[params.templateKey] : undefined;
  if (params.templateKey && !template) throw new Error("There is no template by that name.");

  const facts: AgreementFacts = {
    business: tenant.name,
    customer: party.companyName ?? party.name,
    value: money(params.valueCents, tenant.currency, params.recurrence),
    starts: asDate(params.startsAt),
    ends: asDate(params.endsAt),
  };

  const clauses = params.clauses ?? (template ? fillClauses(template.clauses, facts) : []);
  const title = (params.title ?? template?.title ?? "Agreement")
    .replaceAll("{customer}", facts.customer)
    .replaceAll("{business}", facts.business);

  return prisma.agreement.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      number: await nextAgreementNumber(params.tenantId),
      kind: params.kind ?? template?.kind ?? AgreementKind.OTHER,
      title,
      clauses: clauses as unknown as Prisma.InputJsonValue,
      valueCents: params.valueCents ?? null,
      recurrence: params.recurrence ?? null,
      currency: tenant.currency,
      startsAt: params.startsAt ?? null,
      endsAt: params.endsAt ?? null,
      validUntil: params.validUntil ?? null,
      transactionId,
      createdById: params.createdById ?? null,
    },
  });
}

export async function getAgreement(tenantId: string, id: string) {
  const agreement = await prisma.agreement.findFirst({
    where: { id, tenantId },
    include: { party: true, transaction: { select: { id: true, type: true, externalRef: true, amountCents: true } } },
  });
  if (!agreement) return null;
  return { ...agreement, clauseList: parseClauses(agreement.clauses) };
}

export async function listAgreements(tenantId: string, opts: { partyId?: string; status?: AgreementState } = {}) {
  return prisma.agreement.findMany({
    where: { tenantId, ...(opts.partyId ? { partyId: opts.partyId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });
}

export async function updateAgreement(
  tenantId: string,
  id: string,
  patch: {
    title?: string;
    kind?: AgreementKind;
    clauses?: Clause[];
    valueCents?: number | null;
    recurrence?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    validUntil?: Date | null;
    ourSignerName?: string | null;
    ourSignatureDataUrl?: string | null;
  }
) {
  const existing = await prisma.agreement.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (!existing) throw new Error("That agreement is not in this workspace.");
  // Once it is signed the words are the record of what was agreed. Changing
  // them afterwards is the one thing a contract system must not allow.
  if (existing.status === AgreementState.SIGNED) throw new Error("This has been signed. Make a new version instead of changing it.");

  const { clauses, ...rest } = patch;
  return prisma.agreement.update({
    where: { id },
    data: { ...rest, ...(clauses ? { clauses: clauses as unknown as Prisma.InputJsonValue } : {}) },
  });
}

export async function deleteDraftAgreement(tenantId: string, id: string) {
  const existing = await prisma.agreement.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (!existing) throw new Error("That agreement is not in this workspace.");
  if (existing.status !== AgreementState.DRAFT) throw new Error("Only a draft can be deleted.");
  return prisma.agreement.delete({ where: { id } });
}

/** Out to the customer. From here it is a document somebody may sign. */
export async function sendAgreement(tenantId: string, id: string) {
  const agreement = await prisma.agreement.findFirst({ where: { id, tenantId }, select: { id: true, status: true, clauses: true } });
  if (!agreement) throw new Error("That agreement is not in this workspace.");
  if (agreement.status === AgreementState.SIGNED) throw new Error("This is already signed.");
  if (parseClauses(agreement.clauses).length === 0) throw new Error("There is nothing in this document yet.");

  return prisma.agreement.update({
    where: { id },
    data: { status: AgreementState.SENT, sentAt: new Date(), declinedAt: null },
  });
}

/**
 * The hash that makes a signature mean something.
 *
 * It binds the words, the value and the moment together, so a clause quietly
 * edited afterwards no longer matches what was signed — the same discipline
 * the quote acceptance already uses.
 */
export function acceptanceHashFor(input: { clauses: Clause[]; valueCents: number | null; signerName: string; signedAt: Date }): string {
  const canonical = JSON.stringify({
    clauses: input.clauses.map((c) => [c.heading, c.body]),
    valueCents: input.valueCents,
    signerName: input.signerName.trim().toLowerCase(),
    signedAt: input.signedAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Signed by the customer, from their own portal link. */
export async function signAgreement(params: {
  agreementId: string;
  /** The party the portal token resolved to. Never taken from the request. */
  partyId: string;
  signerName: string;
  signatureDataUrl: string;
  signerIp?: string | null;
}) {
  const agreement = await prisma.agreement.findFirst({
    where: { id: params.agreementId, partyId: params.partyId },
  });
  if (!agreement) throw new Error("That agreement does not belong to this link.");
  if (agreement.status === AgreementState.SIGNED) throw new Error("This has already been signed.");
  if (agreement.status === AgreementState.DRAFT) throw new Error("This has not been sent to you yet.");
  if (!params.signerName.trim()) throw new Error("Type your name as the person signing.");
  if (!params.signatureDataUrl.startsWith("data:image/")) throw new Error("A signature is needed to sign this.");

  const signedAt = new Date();
  const clauses = parseClauses(agreement.clauses);
  return prisma.agreement.update({
    where: { id: agreement.id },
    data: {
      status: AgreementState.SIGNED,
      signedAt,
      signerName: params.signerName.trim(),
      signatureDataUrl: params.signatureDataUrl,
      signerIp: params.signerIp ?? null,
      acceptanceHash: acceptanceHashFor({ clauses, valueCents: agreement.valueCents, signerName: params.signerName, signedAt }),
    },
  });
}

export async function declineAgreement(params: { agreementId: string; partyId: string }) {
  const agreement = await prisma.agreement.findFirst({ where: { id: params.agreementId, partyId: params.partyId }, select: { id: true, status: true } });
  if (!agreement) throw new Error("That agreement does not belong to this link.");
  if (agreement.status === AgreementState.SIGNED) throw new Error("This has already been signed.");
  return prisma.agreement.update({ where: { id: agreement.id }, data: { status: AgreementState.DECLINED, declinedAt: new Date() } });
}

/** Whether the words still match what was signed. Cheap, and worth checking. */
export function signatureStillMatches(agreement: {
  clauses: Prisma.JsonValue;
  valueCents: number | null;
  signerName: string | null;
  signedAt: Date | null;
  acceptanceHash: string | null;
}): boolean | null {
  if (!agreement.acceptanceHash || !agreement.signerName || !agreement.signedAt) return null;
  return (
    acceptanceHashFor({
      clauses: parseClauses(agreement.clauses),
      valueCents: agreement.valueCents,
      signerName: agreement.signerName,
      signedAt: agreement.signedAt,
    }) === agreement.acceptanceHash
  );
}

/** Proposals go stale. Called by the tick so a list never lies about what is live. */
export async function expireStaleAgreements(tenantId: string, now = new Date()) {
  const { count } = await prisma.agreement.updateMany({
    where: { tenantId, status: AgreementState.SENT, validUntil: { not: null, lt: now } },
    data: { status: AgreementState.EXPIRED },
  });
  return count;
}

/** What is out there unanswered, and what is worth. For the brief. */
export async function agreementPipeline(tenantId: string) {
  const rows = await prisma.agreement.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
    _sum: { valueCents: true },
  });
  const by = (s: AgreementState) => rows.find((r) => r.status === s);
  return {
    awaitingSignature: by(AgreementState.SENT)?._count._all ?? 0,
    awaitingValueCents: by(AgreementState.SENT)?._sum.valueCents ?? 0,
    signed: by(AgreementState.SIGNED)?._count._all ?? 0,
    signedValueCents: by(AgreementState.SIGNED)?._sum.valueCents ?? 0,
    drafts: by(AgreementState.DRAFT)?._count._all ?? 0,
  };
}
