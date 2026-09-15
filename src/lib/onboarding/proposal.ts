// What a document, a spreadsheet or a photograph turned out to hold — before
// any of it is written down.
//
// Nothing here touches the database. It is the shape the reading side
// produces, the review screen edits, and the apply side consumes, and every
// value carries the file it came from so the owner is never asked to trust a
// field that appeared from nowhere.
//
// Merging matters as much as reading: a business hands over a registration
// certificate, two invoices and a price list at once, and the same customer
// and the same product appear on more than one of them. They should arrive as
// one list to confirm, not four.

export type IntakeKind =
  | "company_registration"
  | "vat_registration"
  | "tax_certificate"
  | "bbbee_certificate"
  | "bank_letter"
  | "sales_document"
  | "supplier_document"
  | "price_list"
  | "stock_sheet"
  | "contact_list"
  | "letterhead"
  | "website"
  | "spoken"
  | "other";

export const BUSINESS_FIELDS = [
  "name",
  "tradingName",
  "registrationNumber",
  "registeredOn",
  "entityType",
  "vatNumber",
  "businessAddress",
  "businessEmail",
  "businessPhone",
  "website",
  "countryCode",
] as const;
export type BusinessField = (typeof BUSINESS_FIELDS)[number];

export const BANKING_FIELDS = [
  "bankName",
  "bankAccountHolder",
  "bankAccountNumber",
  "bankBranchCode",
  "bankSwift",
] as const;
export type BankingField = (typeof BANKING_FIELDS)[number];

export const FIELD_LABELS: Record<BusinessField | BankingField, string> = {
  name: "Registered name",
  tradingName: "Trading as",
  registrationNumber: "Registration number",
  registeredOn: "Registered on",
  entityType: "Type of business",
  vatNumber: "VAT number",
  businessAddress: "Address",
  businessEmail: "Email",
  businessPhone: "Phone",
  website: "Website",
  countryCode: "Country",
  bankName: "Bank",
  bankAccountHolder: "Account holder",
  bankAccountNumber: "Account number",
  bankBranchCode: "Branch code",
  bankSwift: "SWIFT / BIC",
};

export interface Found<T = string> {
  value: T;
  /** The file, sheet or page this came from, in the owner's words. */
  source: string;
}

export interface ProposedProduct {
  key: string;
  name: string;
  sku: string | null;
  unit: string | null;
  unitPriceCents: number | null;
  costCents: number | null;
  quantityOnHand: number | null;
  taxRatePercent: number | null;
  category: string | null;
  source: string;
}

export interface ProposedParty {
  key: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: string | null;
  source: string;
}

export interface ProposedObligation {
  key: string;
  title: string;
  /** Prisma's ObligationKind, as a string so this file stays free of the client. */
  kind: string;
  authority: string | null;
  reference: string | null;
  /** YYYY-MM-DD, or null when the document did not say. */
  expiresOn: string | null;
  source: string;
}

export interface ReadDocument {
  fileName: string;
  kind: IntakeKind;
  summary: string | null;
  confidence: number | null;
  notes: string | null;
}

export interface Proposal {
  documents: ReadDocument[];
  business: Partial<Record<BusinessField, Found>>;
  banking: Partial<Record<BankingField, Found>>;
  suggestedNiche: Found | null;
  logoDataUrl: Found | null;
  obligations: ProposedObligation[];
  customers: ProposedParty[];
  suppliers: ProposedParty[];
  products: ProposedProduct[];
  /** Files that could not be read, and why — never silently dropped. */
  problems: string[];
}

export function emptyProposal(): Proposal {
  return {
    documents: [],
    business: {},
    banking: {},
    suggestedNiche: null,
    logoDataUrl: null,
    obligations: [],
    customers: [],
    suppliers: [],
    products: [],
    problems: [],
  };
}

export const normalise = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const partyKey = (p: { name: string; email: string | null }) => normalise(p.email) || normalise(p.name);
const productKey = (p: { name: string; sku: string | null }) => normalise(p.sku) || normalise(p.name);

/** Keep what is already there; take what is missing. */
function fillBlanks<T extends object>(into: T, from: T): T {
  const out = { ...into } as Record<string, unknown>;
  for (const [k, v] of Object.entries(from)) {
    if (v !== null && v !== undefined && (out[k] === null || out[k] === undefined || out[k] === "")) out[k] = v;
  }
  return out as T;
}

/**
 * One list out of several readings. The first document to state something
 * wins, later ones fill in what it did not say — so a registration
 * certificate's registered name is not overwritten by an invoice's
 * letterhead, but the invoice's phone number still lands.
 */
export function mergeProposals(...parts: Proposal[]): Proposal {
  const out = emptyProposal();
  for (const p of parts) {
    out.documents.push(...p.documents);
    out.problems.push(...p.problems);
    for (const [k, v] of Object.entries(p.business)) {
      if (v && !out.business[k as BusinessField]) out.business[k as BusinessField] = v;
    }
    for (const [k, v] of Object.entries(p.banking)) {
      if (v && !out.banking[k as BankingField]) out.banking[k as BankingField] = v;
    }
    out.suggestedNiche ??= p.suggestedNiche;
    out.logoDataUrl ??= p.logoDataUrl;

    for (const o of p.obligations) {
      const at = out.obligations.findIndex((x) => normalise(x.title) === normalise(o.title));
      if (at < 0) out.obligations.push(o);
      else out.obligations[at] = fillBlanks(out.obligations[at], o);
    }
    for (const list of ["customers", "suppliers"] as const) {
      for (const party of p[list]) {
        const at = out[list].findIndex((x) => partyKey(x) === partyKey(party));
        if (at < 0) out[list].push(party);
        else out[list][at] = fillBlanks(out[list][at], party);
      }
    }
    for (const product of p.products) {
      const at = out.products.findIndex((x) => productKey(x) === productKey(product));
      if (at < 0) out.products.push(product);
      else out.products[at] = fillBlanks(out.products[at], product);
    }
  }
  return out;
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * What the assistant says it found, in sentences rather than a count of
 * fields. Written from the proposal itself, so it is true on a day the model
 * is unavailable and the reading came from a spreadsheet alone.
 */
export function narrate(p: Proposal): string[] {
  const lines: string[] = [];
  const named = p.business.name?.value;

  if (named) {
    const bits = [
      p.business.registrationNumber && "your registration number",
      p.business.vatNumber && "your VAT number",
      p.business.businessAddress && "your address",
    ].filter(Boolean) as string[];
    lines.push(
      bits.length
        ? `${named} — and ${bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}`}.`
        : `${named}.`
    );
  }
  if (p.banking.bankAccountNumber) {
    lines.push(`Your ${p.banking.bankName?.value ?? "bank"} account, so invoices tell customers where to pay.`);
  }
  if (p.obligations.length) {
    const dated = p.obligations.filter((o) => o.expiresOn).length;
    lines.push(
      `${count(p.obligations.length, "certificate")} with ${dated === p.obligations.length ? "their dates" : "dates on some of them"} — they go on your compliance calendar.`
    );
  }
  if (p.products.length) {
    const priced = p.products.filter((x) => x.unitPriceCents !== null).length;
    const stocked = p.products.filter((x) => x.quantityOnHand !== null).length;
    lines.push(
      `${count(p.products.length, "product")}${priced ? `, ${priced === p.products.length ? "all" : priced} with prices` : ""}${stocked ? `, ${stocked} with stock on hand` : ""}.`
    );
  }
  if (p.customers.length) lines.push(`${count(p.customers.length, "customer")}.`);
  if (p.suppliers.length) lines.push(`${count(p.suppliers.length, "supplier")}.`);
  if (!lines.length) lines.push("Nothing I could use yet — add a file, or type it in below.");
  return lines;
}

/** Everything the owner kept, on its way to being written down. */
export interface AcceptedProposal {
  business: Partial<Record<BusinessField, string>>;
  banking: Partial<Record<BankingField, string>>;
  obligations: ProposedObligation[];
  customers: ProposedParty[];
  suppliers: ProposedParty[];
  products: ProposedProduct[];
  /** Build the compliance calendar for this jurisdiction while we are here. */
  buildCalendar?: boolean;
}

/** Everything in a proposal, accepted as read — the default the review screen starts from. */
export function acceptAll(p: Proposal): AcceptedProposal {
  const values = <F extends string>(found: Partial<Record<F, Found>>) =>
    Object.fromEntries(Object.entries(found).map(([k, v]) => [k, (v as Found).value])) as Partial<Record<F, string>>;
  return {
    business: values<BusinessField>(p.business),
    banking: values<BankingField>(p.banking),
    obligations: p.obligations,
    customers: p.customers,
    suppliers: p.suppliers,
    products: p.products,
  };
}
