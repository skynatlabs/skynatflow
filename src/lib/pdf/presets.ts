// Ready-made document designs.
//
// The twelve base styles in styles.ts only ever varied colour, font and where
// the header sat — the *structure* of the page was the same in all of them.
// That is why picking one never felt like picking a design.
//
// A preset is the other half: a complete section layout plus the style
// settings that go with it. Choosing one gives you a document that already
// works, and the section editor is then for making it yours rather than for
// assembling it from nothing. Nobody wants to build an invoice from parts.
//
// A preset is a starting point, never a lock: applying one overwrites the
// template's sections, and everything it set stays editable afterwards.

import type { SectionConfig, SectionKey } from "./sections";
import { defaultSections } from "./sections";

export interface DocumentPreset {
  key: string;
  label: string;
  description: string;
  /** Style-level settings written onto the template alongside the sections. */
  settings: {
    styleKey: string;
    headerLayout?: "centered" | "split" | "band";
    tableHeaderStyle?: "dark" | "accent" | "line-only";
    fontFamily?: "Helvetica" | "Times-Roman" | "Courier";
    logoShape?: "circle" | "square" | "none";
    accentColorHex?: string;
    textColorHex?: string;
    mutedColorHex?: string;
    pageMargin?: "compact" | "normal" | "roomy";
    fontScale?: number;
    /** Which documents this design is for; defaults to every document. */
    appliesTo?: "ALL" | "QUOTE" | "INVOICE" | "SLIP";
  };
  /** Applied over the catalogue defaults. */
  sections: Array<Partial<SectionConfig> & { key: SectionKey }>;
  /** Sections this design leaves out. */
  hide?: SectionKey[];
  /** The order this design wants; anything omitted keeps catalogue order. */
  order?: SectionKey[];
}

export const DOCUMENT_PRESETS: DocumentPreset[] = [
  {
    key: "classic",
    label: "Classic",
    description: "A plain, everything-in-its-place letterhead. Safe for any document.",
    settings: {
      styleKey: "minimal-mono",
      headerLayout: "split",
      tableHeaderStyle: "dark",
      fontFamily: "Helvetica",
      logoShape: "square",
      pageMargin: "normal",
      fontScale: 1,
    },
    sections: [{ key: "logo", size: "small" }],
    hide: ["signature", "notes"],
  },

  {
    key: "statement",
    label: "Statement",
    description:
      "Big logo, the amount owing called out at the top, numbered line items with descriptions, and a banded balance at the foot.",
    settings: {
      styleKey: "minimal-mono",
      headerLayout: "split",
      tableHeaderStyle: "dark",
      fontFamily: "Helvetica",
      logoShape: "square",
      accentColorHex: "#3f3f46",
      textColorHex: "#27272a",
      mutedColorHex: "#71717a",
      pageMargin: "normal",
      fontScale: 1,
    },
    order: [
      "logo",
      "companyDetails",
      "documentMeta",
      "customerDetails",
      "subject",
      "itemsTable",
      "totals",
      "notes",
      "terms",
      "bankingDetails",
      "verify",
      "footer",
    ],
    sections: [
      { key: "logo", size: "large" },
      {
        key: "documentMeta",
        fields: {
          docLabel: true,
          docNumber: true,
          date: true,
          dueDate: true,
          terms: true,
          poNumber: false,
          balanceDue: true,
        },
      },
      { key: "customerDetails", title: "Bill to" },
      {
        key: "itemsTable",
        fields: {
          rowNumber: true,
          sku: false,
          lineNotes: true,
          quantity: true,
          unitPrice: true,
          discount: false,
          tax: false,
          amount: true,
        },
      },
      {
        key: "totals",
        fields: {
          subtotal: true,
          lineDiscounts: true,
          tax: true,
          documentDiscount: true,
          paymentMade: true,
          balanceDue: true,
        },
      },
      { key: "notes", title: "", body: "Thanks for your business." },
      { key: "footer", align: "center" },
    ],
    hide: ["salesRep", "proposalIntro", "projectDetails", "signature"],
  },

  {
    key: "proposal",
    label: "Proposal",
    description:
      "For quotes you want read: an opening paragraph, scope and timeline, and a signature block at the end.",
    settings: {
      styleKey: "modern-navy",
      headerLayout: "band",
      tableHeaderStyle: "accent",
      fontFamily: "Helvetica",
      logoShape: "square",
      pageMargin: "roomy",
      fontScale: 1,
    },
    order: [
      "logo",
      "companyDetails",
      "documentMeta",
      "customerDetails",
      "salesRep",
      "subject",
      "proposalIntro",
      "projectDetails",
      "itemsTable",
      "totals",
      "terms",
      "signature",
      "bankingDetails",
      "verify",
      "footer",
    ],
    sections: [
      { key: "logo", size: "medium" },
      { key: "customerDetails", title: "Prepared for" },
      {
        key: "terms",
        body: "This quote is valid for 30 days from the date of issue.",
      },
      {
        key: "signature",
        body: "By signing you accept this quote and the terms above.",
      },
    ],
    hide: ["notes"],
  },

  {
    key: "compact",
    label: "Compact",
    description: "Everything on one page. Small type, tight margins, no narrative sections.",
    settings: {
      styleKey: "minimal-serif",
      headerLayout: "split",
      tableHeaderStyle: "line-only",
      fontFamily: "Helvetica",
      logoShape: "square",
      pageMargin: "compact",
      fontScale: 0.85,
    },
    sections: [
      { key: "logo", size: "small" },
      {
        key: "itemsTable",
        fields: {
          rowNumber: false,
          sku: true,
          lineNotes: false,
          quantity: true,
          unitPrice: true,
          discount: false,
          tax: false,
          amount: true,
        },
      },
    ],
    hide: ["salesRep", "proposalIntro", "projectDetails", "signature", "notes", "verify"],
  },

  {
    key: "delivery",
    label: "Delivery slip",
    description: "What was delivered and who signed for it. No prices, no totals breakdown.",
    settings: {
      styleKey: "slip-classic",
      headerLayout: "centered",
      tableHeaderStyle: "line-only",
      fontFamily: "Helvetica",
      logoShape: "none",
      pageMargin: "normal",
      fontScale: 1,
      // Scoped, so it is used for slips and titled "Delivery Slip" rather
      // than inheriting the generic label.
      appliesTo: "SLIP",
    },
    order: [
      "logo",
      "companyDetails",
      "documentMeta",
      "customerDetails",
      "itemsTable",
      "notes",
      "signature",
      "footer",
    ],
    sections: [
      { key: "logo", size: "small" },
      { key: "customerDetails", title: "Deliver to" },
      {
        key: "itemsTable",
        fields: {
          rowNumber: true,
          sku: true,
          lineNotes: false,
          quantity: true,
          unitPrice: false,
          discount: false,
          tax: false,
          amount: false,
        },
      },
      { key: "signature", title: "Received in good order", body: "" },
    ],
    hide: [
      "salesRep",
      "subject",
      "proposalIntro",
      "projectDetails",
      // No money on a delivery slip — which is the whole point of one.
      "totals",
      "terms",
      "bankingDetails",
      "verify",
    ],
  },
];

export const PRESET_BY_KEY: Record<string, DocumentPreset> = Object.fromEntries(
  DOCUMENT_PRESETS.map((p) => [p.key, p])
);

/**
 * The section list a preset produces.
 *
 * Built from the catalogue defaults rather than from the preset alone, so a
 * section added to the app later still appears in every preset instead of
 * every design quietly freezing at the day it was written.
 */
export function sectionsFromPreset(preset: DocumentPreset): SectionConfig[] {
  const base = new Map(defaultSections().map((s) => [s.key, { ...s }]));

  for (const patch of preset.sections) {
    const existing = base.get(patch.key);
    if (!existing) continue;
    base.set(patch.key, {
      ...existing,
      ...patch,
      fields: patch.fields ? { ...existing.fields, ...patch.fields } : existing.fields,
    });
  }

  for (const key of preset.hide ?? []) {
    const existing = base.get(key);
    if (existing) base.set(key, { ...existing, visible: false });
  }

  if (!preset.order) return [...base.values()];

  const ordered: SectionConfig[] = [];
  for (const key of preset.order) {
    const section = base.get(key);
    if (section) {
      ordered.push(section);
      base.delete(key);
    }
  }
  // Whatever the preset didn't name keeps catalogue order, at the end.
  return [...ordered, ...base.values()];
}
