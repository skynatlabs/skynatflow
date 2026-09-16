// The figures SARS asks for, and the file behind them.
//
// Filing itself happens on eFiling. That boundary is on purpose: an automatic
// submission that is wrong is far worse than a number somebody checked, and a
// business cannot delegate its own declaration to software anyway.
//
// What software can do, and what nobody else does for a small South African
// business, is two things. Put each number beside the box it goes in, so the
// owner is copying rather than working anything out. And produce the
// supporting file behind every number, so that when SARS asks — and on a VAT
// refund they always ask — the answer is a spreadsheet already assembled
// rather than a weekend of searching.

import { prisma } from "@/lib/db";
import { computeVatReturn, vatPeriodFor } from "./vatReturn";
import { toCsv } from "@/lib/export/csv";

export interface ReturnField {
  /** The box number on the form, as printed. */
  box: string;
  label: string;
  valueCents: number;
  /** What was counted to get here, in a sentence. */
  basis: string;
}

export interface FilingPack {
  form: "VAT201" | "EMP201" | "ITR14";
  periodLabel: string;
  dueOn: Date;
  fields: ReturnField[];
  /** The rows behind the figures, as a file. */
  supporting: { fileName: string; csv: string; rows: number };
  /** Anything that would make a number wrong, said before it is filed. */
  warnings: string[];
  where: string;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * VAT201, box by box.
 *
 * The form's own numbering, because the alternative is an owner with two
 * windows open trying to work out which of our labels maps to field 12.
 */
export async function vat201(params: { tenantId: string; periodEnd?: Date }): Promise<FilingPack> {
  const period = vatPeriodFor(params.periodEnd ?? new Date());
  const computed = await computeVatReturn(params.tenantId, period.start, period.end);

  const [sales, purchases, tenant] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        tenantId: params.tenantId,
        type: "INVOICE",
        status: { notIn: ["DRAFT", "CANCELLED"] },
        createdAt: { gte: period.start, lte: period.end },
      },
      include: { party: { select: { name: true, companyName: true, vatNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        tenantId: params.tenantId,
        status: { notIn: ["REJECTED", "DUPLICATE"] },
        spentOn: { gte: period.start, lte: period.end },
      },
      include: { supplier: { select: { name: true, companyName: true, vatNumber: true } } },
      orderBy: { spentOn: "asc" },
    }),
  ]).then(async ([s, p]) => [s, p, await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true, vatNumber: true } })] as const);

  // The computation already worked these out from the ledger; taking them
  // from its totals rather than re-deriving them here means the pack and the
  // draft return can never disagree with each other.
  const outputCents = computed.outputCents;
  const inputCents = computed.inputCents;

  const fields: ReturnField[] = [
    {
      box: "1",
      label: "Standard rate supplies (excluding VAT)",
      valueCents: sales.reduce((sum, row) => sum + Math.round(row.amountCents / 1.15), 0),
      basis: "Every invoice sent in the period, less the VAT in it. Drafts and cancellations are not counted.",
    },
    {
      box: "4",
      label: "Output tax",
      valueCents: outputCents,
      basis: "The VAT on those sales.",
    },
    {
      box: "14",
      label: "Input tax",
      valueCents: inputCents,
      basis: "Only the VAT on slips that actually showed it. A slip with no VAT number on it cannot be claimed, however much was spent.",
    },
    {
      box: "20",
      label: computed.netCents >= 0 ? "VAT payable" : "VAT refundable",
      valueCents: Math.abs(computed.netCents),
      basis: computed.netCents >= 0 ? "Output tax less input tax." : "Input tax exceeded output tax for this period.",
    },
  ];

  const supportingRows = [
    ...sales.map((row) => ({
      Kind: "Sale",
      Date: row.createdAt.toISOString().slice(0, 10),
      Reference: row.externalRef ?? row.id.slice(-6).toUpperCase(),
      Party: row.party.companyName ?? row.party.name,
      "VAT number": row.party.vatNumber ?? "",
      "Amount excl": money(Math.round(row.amountCents / 1.15)),
      VAT: money(row.amountCents - Math.round(row.amountCents / 1.15)),
      Total: money(row.amountCents),
    })),
    ...purchases.map((row) => ({
      Kind: "Purchase",
      Date: row.spentOn.toISOString().slice(0, 10),
      Reference: row.reference ?? "",
      Party: row.supplier?.companyName ?? row.supplier?.name ?? row.supplierName ?? "Unknown",
      "VAT number": row.supplier?.vatNumber ?? "",
      "Amount excl": money(row.amountCents - (row.taxCents ?? 0)),
      VAT: money(row.taxCents ?? 0),
      Total: money(row.amountCents),
    })),
  ];

  const warnings: string[] = [];
  const noVatNumber = purchases.filter((row) => row.taxCents && !row.supplier?.vatNumber).length;
  if (noVatNumber > 0) {
    warnings.push(
      `${noVatNumber} ${noVatNumber === 1 ? "purchase claims VAT from a supplier with" : "purchases claim VAT from suppliers with"} no VAT number recorded. SARS disallows those on an audit.`,
    );
  }
  const noSlip = purchases.filter((row) => row.taxCents && !row.receiptDataUrl).length;
  if (noSlip > 0) {
    warnings.push(`${noSlip} ${noSlip === 1 ? "claim has" : "claims have"} no slip attached. A claim without a tax invoice is not a claim.`);
  }
  if (!tenant.vatNumber) warnings.push("This business has no VAT number recorded, which makes the whole return questionable.");

  // The 25th of the month after the period ends, or the last business day
  // before it — eFiling extends to the last business day of the month, but
  // the 25th is the date that keeps a business out of trouble.
  const due = new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth() + 1, 25));
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() - 1);

  return {
    form: "VAT201",
    periodLabel: period.label,
    dueOn: due,
    fields,
    supporting: {
      fileName: `vat201-support-${period.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      csv: asCsv(supportingRows),
      rows: supportingRows.length,
    },
    warnings,
    where: "eFiling → Returns → VAT201. Type the boxes in, attach nothing — keep the supporting file for when they ask.",
  };
}

function asCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return toCsv(
    headers,
    rows.map((row) => headers.map((header) => row[header] ?? "")),
  );
}

/**
 * The year-end pack.
 *
 * Not a tax computation — that is an accountant's work and pretending
 * otherwise would be the most expensive kind of wrong. What this is: every
 * document an accountant asks for at year end, assembled, so the first
 * conversation is about the numbers instead of about missing paperwork.
 */
export async function yearEndPack(params: { tenantId: string; yearEnd: Date }) {
  const start = new Date(Date.UTC(params.yearEnd.getUTCFullYear() - 1, params.yearEnd.getUTCMonth(), params.yearEnd.getUTCDate() + 1));

  const [invoices, expenses, assets, loans, stock] = await Promise.all([
    prisma.transaction.count({ where: { tenantId: params.tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: start, lte: params.yearEnd } } }),
    prisma.expense.count({ where: { tenantId: params.tenantId, status: { notIn: ["REJECTED", "DUPLICATE"] }, spentOn: { gte: start, lte: params.yearEnd } } }),
    prisma.asset.count({ where: { tenantId: params.tenantId } }),
    prisma.expense.count({ where: { tenantId: params.tenantId, isOwnerDrawing: true, spentOn: { gte: start, lte: params.yearEnd } } }),
    prisma.item.count({ where: { tenantId: params.tenantId, stockQty: { gt: 0 } } }),
  ]);

  const checklist = [
    { item: "Sales for the year", have: invoices > 0, detail: `${invoices} invoices` },
    { item: "Costs for the year", have: expenses > 0, detail: `${expenses} costs recorded` },
    { item: "Fixed asset register", have: assets > 0, detail: assets > 0 ? `${assets} assets with their depreciation` : "Nothing recorded — if the business owns vehicles or equipment, they belong here" },
    { item: "Owner drawings, separated from costs", have: loans > 0, detail: loans > 0 ? `${loans} marked as drawings` : "Nothing marked. If the owner took money out, it is currently sitting in the costs and understating the profit" },
    { item: "Closing stock", have: stock > 0, detail: stock > 0 ? `${stock} lines on hand` : "No stock on hand recorded" },
  ];

  return {
    periodStart: start,
    periodEnd: params.yearEnd,
    checklist,
    ready: checklist.filter((row) => row.have).length,
    of: checklist.length,
    note: "This is what an accountant asks for at year end. It is not a tax computation — that is their work, and software that pretended otherwise would be wrong in the most expensive way there is.",
  };
}
