// A quote, proposal or invoice as an editable Word document.
//
// The PDF is what gets sent; this is for the customer who says "send it in
// Word so we can fill in our order number", and for the owner who wants to
// add a paragraph their template does not have. Same content, same order, no
// design — Word will not reproduce the letterhead, and pretending otherwise
// produces a worse document than admitting it.

import { computeDocumentTotal } from "@/lib/core/pricing";
import { formatMoney } from "@/lib/format/money";
import { buildDocx, type DocxBlock } from "./docx";

export interface DocumentForWord {
  kind: "Quote" | "Proposal" | "Invoice";
  number: string;
  issuedAt: Date;
  dueAt?: Date | null;
  currency: string;
  subject?: string | null;
  poNumber?: string | null;
  amountCents: number;
  discountPercent?: number | null;
  business: {
    name: string;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    vatNumber?: string | null;
    registrationNumber?: string | null;
    bankName?: string | null;
    bankAccountHolder?: string | null;
    bankAccountNumber?: string | null;
    bankBranchCode?: string | null;
  };
  customer: { name: string; companyName?: string | null; email?: string | null; phone?: string | null; addressLine?: string | null; vatNumber?: string | null };
  lines: Array<{ name: string; description?: string | null; quantity: number; unit?: string | null; unitPriceCents: number; discountPercent?: number | null; taxRatePercent?: number | null }>;
  proposal?: { introText?: string | null; scopeOfWork?: string | null; projectLocation?: string | null; projectTimeline?: string | null; performanceExpectancy?: string | null; systemInfo?: string | null } | null;
}

export function documentToDocx(doc: DocumentForWord): { fileName: string; data: Buffer } {
  const money = (cents: number) => formatMoney(cents, doc.currency);
  const totals = computeDocumentTotal(
    doc.lines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent ?? 0,
      taxRatePercent: l.taxRatePercent ?? undefined,
    })),
    doc.discountPercent ?? 0
  );

  const contact = [doc.business.address, doc.business.email, doc.business.phone].filter(Boolean).join(" · ");
  const numbers = [
    doc.business.vatNumber ? `VAT ${doc.business.vatNumber}` : null,
    doc.business.registrationNumber ? `Reg ${doc.business.registrationNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: DocxBlock[] = [
    { kind: "heading", text: doc.business.name, level: 1 },
    ...(contact ? [{ kind: "paragraph" as const, text: contact, muted: true }] : []),
    ...(numbers ? [{ kind: "paragraph" as const, text: numbers, muted: true }] : []),
    { kind: "spacer" },
    { kind: "heading", text: `${doc.kind} ${doc.number}`, level: 2 },
    {
      kind: "paragraph",
      text: [
        `Date: ${doc.issuedAt.toLocaleDateString()}`,
        doc.dueAt ? `Due: ${doc.dueAt.toLocaleDateString()}` : null,
        doc.poNumber ? `Your reference: ${doc.poNumber}` : null,
      ]
        .filter(Boolean)
        .join("   "),
      muted: true,
    },
    { kind: "paragraph", text: "To", bold: true },
    {
      kind: "paragraph",
      text: [
        doc.customer.companyName ?? doc.customer.name,
        doc.customer.companyName ? doc.customer.name : null,
        doc.customer.addressLine,
        doc.customer.email,
        doc.customer.phone,
        doc.customer.vatNumber ? `VAT ${doc.customer.vatNumber}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    ...(doc.subject ? [{ kind: "paragraph" as const, text: doc.subject, bold: true }] : []),
  ];

  if (doc.proposal) {
    for (const [title, text] of [
      ["Introduction", doc.proposal.introText],
      ["Scope of work", doc.proposal.scopeOfWork],
      ["Where", doc.proposal.projectLocation],
      ["Timeline", doc.proposal.projectTimeline],
      ["What to expect", doc.proposal.performanceExpectancy],
      ["The system", doc.proposal.systemInfo],
    ] as const) {
      if (!text) continue;
      blocks.push({ kind: "heading", text: title, level: 2 }, { kind: "paragraph", text });
    }
  }

  blocks.push({
    kind: "table",
    header: ["Item", "Qty", "Price", "Amount"],
    align: ["left", "right", "right", "right"],
    rows: doc.lines.map((l) => {
      const gross = l.quantity * l.unitPriceCents;
      const afterDiscount = gross - Math.round((gross * (l.discountPercent ?? 0)) / 100);
      return [
        [l.name, l.description].filter(Boolean).join(" — "),
        `${l.quantity}${l.unit ? ` ${l.unit}` : ""}`,
        money(l.unitPriceCents),
        money(afterDiscount),
      ];
    }),
  });

  const totalRows: string[][] = [["Subtotal", money(totals.subtotalCents)]];
  if (totals.lineDiscountCents > 0) totalRows.push(["Line discounts", `−${money(totals.lineDiscountCents)}`]);
  if (totals.documentDiscountCents > 0) totalRows.push(["Discount", `−${money(totals.documentDiscountCents)}`]);
  if (totals.taxCents > 0) totalRows.push(["Tax", money(totals.taxCents)]);
  totalRows.push([doc.kind === "Invoice" ? "Total due" : "Total", money(doc.lines.length > 0 ? totals.totalCents : doc.amountCents)]);
  blocks.push({ kind: "table", header: ["", ""], align: ["left", "right"], rows: totalRows });

  if (doc.kind === "Invoice" && doc.business.bankAccountNumber) {
    blocks.push(
      { kind: "heading", text: "Where to pay", level: 2 },
      {
        kind: "paragraph",
        text: [
          doc.business.bankAccountHolder ?? doc.business.name,
          doc.business.bankName,
          `Account ${doc.business.bankAccountNumber}`,
          doc.business.bankBranchCode ? `Branch ${doc.business.bankBranchCode}` : null,
          `Reference ${doc.number}`,
        ]
          .filter(Boolean)
          .join("\n"),
      }
    );
  }

  const slug = `${doc.kind.toLowerCase()}-${doc.number}`.replace(/[^a-z0-9-]+/gi, "-");
  return { fileName: `${slug}.docx`, data: buildDocx({ title: `${doc.kind} ${doc.number} — ${doc.business.name}`, blocks }) };
}
