// Importing quotes and invoices from another system's export.
//
// Three things went wrong with the first version, and each is handled here:
//
//  1. One row per line item. Zoho, QuickBooks and the rest repeat the whole
//     document header on every line-item row; imported row by row that is one
//     empty document per line. Rows are grouped back into documents by the
//     source's own document number.
//
//  2. Running it again. The source's document number was never kept, so a
//     second import duplicated everything, and the quotes that arrived empty
//     before the grouping fix could never be repaired. It is now stored as
//     externalRef: a document already here is not created twice, and one that
//     arrived with no lines gets its lines filled in.
//
//  3. Saying nothing. An export whose item columns were not mapped produced
//     quotes with a customer and a total and no items, silently. The result
//     now counts those, so the screen can say so.
//
// Item descriptions, tax and discounts, previously read and dropped, now
// reach the catalogue item and the line.

import { PartyRole, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createProduct } from "@/lib/core/catalog";
import { recordPayment } from "@/lib/core/money";

export interface DocumentImportResult {
  imported: number;
  /** Documents already here that arrived with no lines and now have them. */
  repaired: number;
  /** Documents already here, complete, left alone. */
  alreadyHere: number;
  skipped: number;
  /** Imported with no line items, because the export's item columns were not mapped or were empty. */
  withoutLines: number;
  errors: string[];
}

export function parseAmountCents(raw: string | undefined): number | null {
  const cleaned = (raw ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function parsePercent(raw: string | undefined): number | undefined {
  const cleaned = (raw ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}

export function parseDate(raw: string | undefined): Date | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  // dd/mm/yyyy — how a South African or European export writes a date, and
  // the one JavaScript reads as mm/dd when it reads it at all.
  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy.map(Number) as unknown as [number, number, number, number];
    if (m <= 12 && d <= 31) {
      const date = new Date(Date.UTC(y, m - 1, d, 12));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseQuoteStatus(raw: string | undefined): TransactionStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.includes("accept") || s.includes("invoiced")) return TransactionStatus.ACCEPTED;
  if (s.includes("declin") || s.includes("reject")) return TransactionStatus.DECLINED;
  if (s.includes("draft")) return TransactionStatus.DRAFT;
  return TransactionStatus.SENT;
}

export function isInvoicePaid(raw: string | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s.includes("paid") && !s.includes("unpaid") && !s.includes("partial");
}

export function parseInvoiceStatus(raw: string | undefined): TransactionStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.includes("partial")) return TransactionStatus.PARTIALLY_PAID;
  if (s.includes("overdue")) return TransactionStatus.OVERDUE;
  if (s.includes("void") || s.includes("cancel")) return TransactionStatus.CANCELLED;
  if (s.includes("draft")) return TransactionStatus.DRAFT;
  return TransactionStatus.SENT;
}

function parseQty(raw: string | undefined): number {
  const n = Number((raw ?? "").replace(/[^0-9.-]/g, ""));
  // A line with no quantity is one of the thing, which is what every export
  // means by leaving it blank.
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

interface PendingLine {
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  taxRatePercent?: number;
  discountPercent?: number;
}

async function findOrCreateItem(tenantId: string, line: PendingLine) {
  const existing = await prisma.item.findFirst({ where: { tenantId, name: line.name } });
  if (existing) {
    // Fill in what the catalogue did not know; never overwrite what it did.
    if (!existing.description && line.description) {
      return prisma.item.update({ where: { id: existing.id }, data: { description: line.description } });
    }
    return existing;
  }
  const created = await createProduct({ tenantId, name: line.name, unitPriceCents: line.unitPriceCents, taxRatePercent: line.taxRatePercent });
  return line.description ? prisma.item.update({ where: { id: created.id }, data: { description: line.description } }) : created;
}

async function attachLines(tenantId: string, transactionId: string, lines: PendingLine[]) {
  for (const line of lines) {
    const item = await findOrCreateItem(tenantId, line);
    await prisma.transactionLine.create({
      data: {
        transactionId,
        itemId: item.id,
        quantity: line.quantity,
        // Snapshotted from the export rather than read off the catalogue, so
        // importing a two-year-old quote records what was actually charged
        // then, not what the item costs today.
        unitPriceCents: line.unitPriceCents,
        taxRatePercent: line.taxRatePercent,
        discountPercent: line.discountPercent ?? 0,
      },
    });
  }
}

/**
 * Collapse one-row-per-line-item exports back into documents, grouped by the
 * source's own document number. Without a number there is nothing reliable
 * to group on — two genuinely separate same-day quotes to one customer look
 * exactly like two lines of one quote — so each row stays its own document.
 */
export function groupRows(records: Record<string, string>[]) {
  const hasItems = records.some((r) => (r.itemName ?? "").trim() || (r.itemDescription ?? "").trim());
  const hasReference = records.some((r) => (r.reference ?? "").trim());
  const keyFor = (record: Record<string, string>, index: number) =>
    hasItems && hasReference && (record.reference ?? "").trim() ? `ref:${record.reference.trim()}` : `row:${index}`;

  const lines = new Map<string, PendingLine[]>();
  const headers: Array<Record<string, string> & { __key: string }> = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const key = keyFor(record, index);
    if (!seen.has(key)) {
      seen.add(key);
      headers.push({ ...record, __key: key });
    }
    const description = (record.itemDescription ?? "").trim() || null;
    // An export that only has a description column still has a line.
    const name = (record.itemName ?? "").trim() || (description ? description.split("\n")[0].slice(0, 120) : "");
    if (!name) return;
    const bucket = lines.get(key) ?? [];
    bucket.push({
      name,
      description: description && description !== name ? description : null,
      quantity: parseQty(record.itemQuantity),
      unitPriceCents: parseAmountCents(record.itemRate) ?? 0,
      taxRatePercent: parsePercent(record.itemTaxPercent),
      discountPercent: parsePercent(record.itemDiscountPercent),
    });
    lines.set(key, bucket);
  });

  return { headers, lines, hasItems };
}

export async function importDocuments(params: {
  tenantId: string;
  target: "quotes" | "invoices";
  records: Record<string, string>[];
  partyRole: PartyRole;
}): Promise<DocumentImportResult> {
  const { tenantId, target, records, partyRole } = params;
  const type = target === "quotes" ? TransactionType.QUOTE : TransactionType.INVOICE;
  const result: DocumentImportResult = { imported: 0, repaired: 0, alreadyHere: 0, skipped: 0, withoutLines: 0, errors: [] };
  const { headers, lines } = groupRows(records);

  for (const [i, record] of headers.entries()) {
    try {
      const customerName = record.customerName?.trim();
      const amountCents = parseAmountCents(record.amountCents);
      if (!customerName || amountCents === null) {
        result.skipped++;
        continue;
      }
      const docLines = lines.get(record.__key) ?? [];
      const externalRef = (record.reference ?? "").trim() || null;

      if (externalRef) {
        const existing = await prisma.transaction.findFirst({
          where: { tenantId, type, externalRef },
          select: { id: true, _count: { select: { itemLines: true } } },
        });
        if (existing) {
          if (existing._count.itemLines === 0 && docLines.length > 0) {
            await attachLines(tenantId, existing.id, docLines);
            result.repaired++;
          } else {
            result.alreadyHere++;
          }
          continue;
        }
      }

      let party = await prisma.party.findFirst({ where: { tenantId, name: customerName } });
      party ??= await createParty({ tenantId, role: partyRole, name: customerName });
      const createdAt = parseDate(record.date);

      const doc = await prisma.transaction.create({
        data: {
          tenantId,
          partyId: party.id,
          type,
          status: target === "quotes" ? parseQuoteStatus(record.status) : parseInvoiceStatus(record.status),
          amountCents,
          externalRef,
          subject: (record.subject ?? "").trim() || null,
          ...(target === "invoices" ? { dueAt: parseDate(record.dueDate) } : {}),
          ...(createdAt ? { createdAt } : {}),
        },
      });
      await attachLines(tenantId, doc.id, docLines);
      if (docLines.length === 0) result.withoutLines++;
      // A paid historical invoice needs a real payment row, not a status
      // flag, so balances and the books derived from them stay right.
      if (target === "invoices" && isInvoicePaid(record.status)) {
        await recordPayment({ invoiceId: doc.id, amountCents });
      }
      result.imported++;
    } catch (err) {
      result.errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
  return result;
}

/**
 * Link documents that arrived before externalRef existed to their source
 * number, so a re-import can repair them. Matches on customer, total and day,
 * and only where exactly one document fits — anything ambiguous is left.
 */
export async function adoptExistingReferences(params: {
  tenantId: string;
  target: "quotes" | "invoices";
  records: Record<string, string>[];
}): Promise<number> {
  const { tenantId, target, records } = params;
  const type = target === "quotes" ? TransactionType.QUOTE : TransactionType.INVOICE;
  const { headers } = groupRows(records);
  let adopted = 0;
  for (const h of headers) {
    const ref = (h.reference ?? "").trim();
    const name = h.customerName?.trim();
    const amount = parseAmountCents(h.amountCents);
    if (!ref || !name || amount === null) continue;
    const already = await prisma.transaction.findFirst({ where: { tenantId, type, externalRef: ref }, select: { id: true } });
    if (already) continue;
    const date = parseDate(h.date);
    const candidates = await prisma.transaction.findMany({
      where: {
        tenantId,
        type,
        externalRef: null,
        amountCents: amount,
        party: { name },
        ...(date ? { createdAt: { gte: new Date(date.getTime() - 36 * 3_600_000), lte: new Date(date.getTime() + 36 * 3_600_000) } } : {}),
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length === 1) {
      await prisma.transaction.update({ where: { id: candidates[0].id }, data: { externalRef: ref } });
      adopted++;
    }
  }
  return adopted;
}
