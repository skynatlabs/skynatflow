// Every block a document is made of, and what can be changed about each one.
//
// The old builder offered three optional blocks (terms, banking, verify) that
// could be reordered or hidden, and nothing else — and one of those three,
// terms, had no field anywhere in the app to write the text, so it rendered
// empty no matter what you did with it. Everything else about the page was
// fixed code.
//
// This is the catalogue that replaces it. Each section declares what it
// supports — a heading you can rename, body text you can write, individual
// fields you can switch off, alignment — and the renderer walks the resolved
// list in order rather than hardcoding the page.
//
// Two zones, deliberately. Header parts stay in the header: a logo reordered
// to sit below the totals is not a layout anyone wants, and pretending
// otherwise would make the builder feel powerful while producing nonsense.
// Within each zone, order is yours.

export type SectionZone = "header" | "body";

/**
 * Which panel of the editor a section is edited from.
 *
 * Grouped by what a person is trying to change ("the table", "the totals"),
 * not by where the renderer draws it — a single long list of sixteen blocks
 * is a list nobody reads to the end of.
 */
export type SectionTab =
  | "headerFooter"
  | "transaction"
  | "table"
  | "total"
  | "other";

export const SECTION_TABS: { key: SectionTab; label: string }[] = [
  { key: "headerFooter", label: "Header & Footer" },
  { key: "transaction", label: "Transaction Details" },
  { key: "table", label: "Table" },
  { key: "total", label: "Total" },
  { key: "other", label: "Other Details" },
];

export type SectionKey =
  | "logo"
  | "companyDetails"
  | "documentMeta"
  | "customerDetails"
  | "salesRep"
  | "subject"
  | "proposalIntro"
  | "projectDetails"
  | "itemsTable"
  | "totals"
  | "notes"
  | "terms"
  | "bankingDetails"
  | "signature"
  | "verify"
  | "footer";

/** One switchable field inside a section. */
export interface SectionField {
  key: string;
  label: string;
  default: boolean;
}

export interface SectionDef {
  key: SectionKey;
  zone: SectionZone;
  tab: SectionTab;
  label: string;
  hint: string;
  /** Sections without which the document is meaningless. */
  locked?: boolean;
  /** The heading above the block can be renamed or cleared. */
  title?: string;
  /** The owner writes this text themselves. */
  supportsBody?: boolean;
  bodyPlaceholder?: string;
  supportsAlign?: boolean;
  /** Offers small / medium / large — only the logo, so far. */
  supportsSize?: boolean;
  fields?: SectionField[];
}

export const SECTION_CATALOGUE: SectionDef[] = [
  {
    key: "logo",
    tab: "headerFooter",
    zone: "header",
    label: "Logo",
    hint: "Your mark at the top of the page. Set its size below.",
    supportsAlign: true,
    supportsSize: true,
  },
  {
    key: "companyDetails",
    tab: "headerFooter",
    zone: "header",
    label: "Your business",
    hint: "Name, address and contact details.",
    supportsAlign: true,
    fields: [
      { key: "name", label: "Business name", default: true },
      { key: "address", label: "Address", default: true },
      { key: "email", label: "Email", default: true },
      { key: "phone", label: "Phone", default: true },
      { key: "vatNumber", label: "VAT number", default: true },
      { key: "regNumber", label: "Registration number", default: false },
    ],
  },
  {
    key: "documentMeta",
    tab: "headerFooter",
    zone: "header",
    label: "Document details",
    hint: "The title, number and dates.",
    title: "",
    fields: [
      { key: "docLabel", label: "Title (Quote / Invoice)", default: true },
      { key: "docNumber", label: "Number", default: true },
      { key: "date", label: "Date issued", default: true },
      { key: "dueDate", label: "Due date", default: true },
      { key: "poNumber", label: "PO number", default: true },
      { key: "balanceDue", label: "Balance due headline", default: false },
      { key: "terms", label: "Payment terms", default: false },
    ],
  },
  {
    key: "customerDetails",
    tab: "transaction",
    zone: "body",
    label: "Customer",
    hint: "Who the document is for.",
    title: "To",
    fields: [
      { key: "name", label: "Name", default: true },
      { key: "company", label: "Company", default: true },
      { key: "email", label: "Email", default: true },
      { key: "phone", label: "Phone", default: true },
      { key: "address", label: "Address", default: true },
      { key: "vatNumber", label: "VAT number", default: false },
    ],
  },
  {
    key: "salesRep",
    tab: "transaction",
    zone: "body",
    label: "Sales rep",
    hint: "Who to contact about this document.",
    title: "Sales rep",
    fields: [
      { key: "name", label: "Name", default: true },
      { key: "email", label: "Email", default: true },
      { key: "phone", label: "Phone", default: true },
    ],
  },
  {
    key: "subject",
    tab: "transaction",
    zone: "body",
    label: "Subject line",
    hint: "What this document is for, from the document itself.",
    title: "",
  },
  {
    key: "proposalIntro",
    tab: "transaction",
    zone: "body",
    label: "Introduction",
    hint: "Opening paragraph on proposal-style quotes.",
    title: "",
  },
  {
    key: "projectDetails",
    tab: "transaction",
    zone: "body",
    label: "Project details",
    hint: "Scope, location, timeline and equipment on a proposal.",
    fields: [
      { key: "projectLocation", label: "Location", default: true },
      { key: "scopeOfWork", label: "Scope of work", default: true },
      { key: "systemInfo", label: "System / equipment", default: true },
      { key: "performanceExpectancy", label: "Expected performance", default: true },
      { key: "projectTimeline", label: "Timeline", default: true },
    ],
  },
  {
    key: "itemsTable",
    tab: "table",
    zone: "body",
    label: "Items",
    hint: "The line items. Choose which columns appear.",
    locked: true,
    fields: [
      { key: "rowNumber", label: "Row numbers", default: false },
      { key: "sku", label: "SKU", default: true },
      { key: "lineNotes", label: "Item descriptions", default: true },
      { key: "quantity", label: "Quantity", default: true },
      { key: "unitPrice", label: "Unit price", default: false },
      { key: "discount", label: "Discount", default: true },
      { key: "tax", label: "Tax", default: true },
      { key: "amount", label: "Amount", default: true },
    ],
  },
  {
    key: "totals",
    tab: "total",
    zone: "body",
    label: "Totals",
    hint: "Subtotal, tax, discount and the amount due.",
    // Not locked, unlike the items table. A delivery slip is a real document
    // with no money on it at all, and a locked totals block meant one still
    // printed a grand total under a table that deliberately showed no prices.
    fields: [
      { key: "subtotal", label: "Subtotal", default: true },
      { key: "lineDiscounts", label: "Line discounts", default: true },
      { key: "tax", label: "Tax", default: true },
      { key: "documentDiscount", label: "Document discount", default: true },
      { key: "paymentMade", label: "Payments received", default: false },
      { key: "balanceDue", label: "Balance due", default: false },
    ],
  },
  {
    key: "notes",
    tab: "other",
    zone: "body",
    label: "Notes",
    hint: "Anything you want on every document.",
    title: "Notes",
    supportsBody: true,
    bodyPlaceholder: "Thank you for your business.",
  },
  {
    key: "terms",
    tab: "other",
    zone: "body",
    label: "Terms",
    hint: "Your standard terms and conditions.",
    title: "Terms",
    supportsBody: true,
    bodyPlaceholder: "Payment due within 30 days of invoice date.",
  },
  {
    key: "bankingDetails",
    tab: "other",
    zone: "body",
    label: "Banking details",
    hint: "Taken from Settings → Banking.",
    title: "Banking details",
    fields: [
      { key: "bankName", label: "Bank", default: true },
      { key: "accountHolder", label: "Account holder", default: true },
      { key: "accountNumber", label: "Account number", default: true },
      { key: "branchCode", label: "Branch code", default: true },
      { key: "swift", label: "SWIFT", default: true },
    ],
  },
  {
    key: "signature",
    tab: "other",
    zone: "body",
    label: "Signature block",
    hint: "Lines for a signature, name and date.",
    title: "Accepted by",
    supportsBody: true,
    bodyPlaceholder: "By signing you accept the quote and the terms above.",
    fields: [
      { key: "signature", label: "Signature line", default: true },
      { key: "name", label: "Name line", default: true },
      { key: "date", label: "Date line", default: true },
    ],
  },
  {
    key: "verify",
    tab: "other",
    zone: "body",
    label: "Verify this document",
    hint: "Anti-impersonation note with your WhatsApp number.",
    title: "Verify this document",
  },
  {
    key: "footer",
    tab: "headerFooter",
    zone: "body",
    label: "Footer",
    hint: "The strip at the very bottom, with the online link and QR code.",
    title: "",
    supportsAlign: true,
    supportsBody: true,
    bodyPlaceholder: "Registered in South Africa.",
    fields: [
      { key: "viewOnline", label: "View-online link", default: true },
      { key: "qr", label: "QR code", default: true },
      { key: "pageNumbers", label: "Page numbers", default: true },
      { key: "branding", label: "Made with flow", default: true },
    ],
  },
];

export const SECTION_BY_KEY: Record<string, SectionDef> = Object.fromEntries(
  SECTION_CATALOGUE.map((s) => [s.key, s])
);

/** What one section looks like once the owner has had their way with it. */
export interface SectionConfig {
  key: SectionKey;
  visible: boolean;
  /** Overrides the catalogue heading. Empty string = no heading. */
  title?: string;
  /** Owner-written text, for the sections that take it. */
  body?: string;
  align?: "left" | "center" | "right";
  size?: "small" | "medium" | "large";
  /** Per-field switches; anything absent falls back to the catalogue default. */
  fields?: Record<string, boolean>;
}

export function defaultSections(): SectionConfig[] {
  return SECTION_CATALOGUE.map((def) => ({
    key: def.key,
    visible: true,
    title: def.title,
    body: undefined,
    align: undefined,
    fields: def.fields
      ? Object.fromEntries(def.fields.map((f) => [f.key, f.default]))
      : undefined,
  }));
}

function isSectionConfig(value: unknown): value is SectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    SECTION_BY_KEY[(value as { key: string }).key] !== undefined
  );
}

/**
 * The saved config, merged over the catalogue.
 *
 * Two jobs beyond merging. A section added to the catalogue after a template
 * was saved is appended visible rather than silently dropped — the failure
 * mode of storing a list is that it quietly becomes the whole truth. And a
 * locked section can never end up hidden, however the stored JSON got that
 * way, because a document with no line items is not a document.
 */
export function resolveSections(saved: unknown): SectionConfig[] {
  const stored = Array.isArray(saved) ? saved.filter(isSectionConfig) : [];
  const byKey = new Map(stored.map((s) => [s.key, s]));

  const ordered: SectionConfig[] = [];
  for (const s of stored) {
    const def = SECTION_BY_KEY[s.key];
    ordered.push({
      key: s.key,
      visible: def.locked ? true : s.visible !== false,
      title: s.title ?? def.title,
      body: s.body,
      align: s.align,
      size: s.size,
      fields: def.fields
        ? Object.fromEntries(
            def.fields.map((f) => [f.key, s.fields?.[f.key] ?? f.default])
          )
        : undefined,
    });
  }

  for (const def of SECTION_CATALOGUE) {
    if (byKey.has(def.key)) continue;
    ordered.push({
      key: def.key,
      visible: true,
      title: def.title,
      fields: def.fields
        ? Object.fromEntries(def.fields.map((f) => [f.key, f.default]))
        : undefined,
    });
  }

  return ordered;
}

/** The visible sections of one zone, in the owner's order. */
export function sectionsFor(
  sections: SectionConfig[],
  zone: SectionZone
): SectionConfig[] {
  return sections.filter((s) => s.visible && SECTION_BY_KEY[s.key].zone === zone);
}

export function fieldOn(section: SectionConfig | undefined, field: string): boolean {
  if (!section) return false;
  return section.fields?.[field] !== false;
}

export function findSection(
  sections: SectionConfig[],
  key: SectionKey
): SectionConfig | undefined {
  return sections.find((s) => s.key === key && s.visible);
}
