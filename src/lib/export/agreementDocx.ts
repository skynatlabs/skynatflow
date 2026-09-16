// A contract as an editable Word document.
//
// This is the one document where "send it in Word" is not a preference but
// the way the work actually gets done: the customer's attorney marks up two
// clauses, sends it back, and the deal closes on the redline. A PDF makes
// that a retyping exercise, so the Word version is a first-class output
// rather than a convenience — same words, same order, no letterhead, because
// Word will not reproduce one and pretending otherwise produces a worse
// document than admitting it.

import { buildDocx, type DocxBlock } from "./docx";
import { formatMoney } from "@/lib/format/money";
import type { Clause } from "@/lib/core/agreements";

export interface AgreementForWord {
  number: string;
  title: string;
  kindLabel: string;
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  validUntil: Date | null;
  valueCents: number | null;
  recurrence: string | null;
  currency: string;
  clauses: Clause[];
  business: { name: string; registrationNumber?: string | null; vatNumber?: string | null; address?: string | null; email?: string | null; phone?: string | null };
  customer: { name: string; companyName?: string | null; vatNumber?: string | null; address?: string | null; email?: string | null; phone?: string | null };
  signature?: { signerName: string; signedAt: Date; hash?: string | null } | null;
  ourSignerName?: string | null;
}

function longDate(d: Date | null | undefined): string | null {
  return d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : null;
}

export function agreementToDocx(a: AgreementForWord): { fileName: string; data: Buffer } {
  const per =
    a.recurrence === "monthly" ? " a month" : a.recurrence === "quarterly" ? " a quarter" : a.recurrence === "annually" ? " a year" : "";

  const partyLines = (p: AgreementForWord["business"] & { companyName?: string | null }) =>
    [
      p.companyName ?? p.name,
      p.registrationNumber ? `Reg: ${p.registrationNumber}` : null,
      p.vatNumber ? `VAT: ${p.vatNumber}` : null,
      p.address,
      p.email,
      p.phone,
    ]
      .filter(Boolean)
      .join("\n");

  const blocks: DocxBlock[] = [
    { kind: "paragraph", text: a.kindLabel.toUpperCase(), muted: true },
    { kind: "heading", text: a.title, level: 1 },
    { kind: "paragraph", text: `No. ${a.number} · ${longDate(a.createdAt)}`, muted: true },
    { kind: "spacer" },
    { kind: "heading", text: "Between", level: 2 },
    { kind: "paragraph", text: partyLines(a.business) },
    { kind: "heading", text: "And", level: 2 },
    { kind: "paragraph", text: partyLines(a.customer) },
  ];

  const terms = [
    a.valueCents !== null ? ["Value", `${formatMoney(a.valueCents, a.currency, { decimals: true })}${per}`] : null,
    longDate(a.startsAt) ? ["Starts", longDate(a.startsAt)!] : null,
    longDate(a.endsAt) ? ["Ends", longDate(a.endsAt)!] : null,
    longDate(a.validUntil) ? ["Valid until", longDate(a.validUntil)!] : null,
  ].filter(Boolean) as string[][];
  if (terms.length > 0) {
    blocks.push({ kind: "spacer" }, { kind: "table", header: ["Term", ""], rows: terms });
  }

  // Numbered in the text, because Word's own list numbering would renumber
  // itself the moment somebody deletes a clause — and a contract that cites
  // "clause 7" needs 7 to stay 7 in the copy that comes back.
  a.clauses.forEach((c, i) => {
    blocks.push({ kind: "heading", text: `${i + 1}. ${c.heading}`, level: 2 }, { kind: "paragraph", text: c.body });
  });

  blocks.push(
    { kind: "spacer" },
    { kind: "heading", text: "Signed", level: 2 },
    {
      kind: "table",
      header: [`For ${a.business.name}`, `For ${a.customer.companyName ?? a.customer.name}`],
      rows: [
        [a.ourSignerName ?? "", a.signature?.signerName ?? ""],
        ["Date:", a.signature ? longDate(a.signature.signedAt)! : "Date:"],
      ],
    }
  );

  if (a.signature?.hash) {
    blocks.push({
      kind: "paragraph",
      text: `Signed record — this acceptance is bound to ${a.signature.hash}. Any later change to the wording above no longer matches it.`,
      muted: true,
    });
  }

  return {
    fileName: `${a.number}-${a.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60).toLowerCase()}.docx`,
    data: buildDocx({ title: `${a.number} ${a.title}`, blocks }),
  };
}
