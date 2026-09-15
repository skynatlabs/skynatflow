"use server";

import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createProduct } from "@/lib/core/catalog";
import { recordPayment } from "@/lib/core/money";
import { PartyRole, TransactionStatus, TransactionType } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

type Target = "customers" | "products" | "quotes" | "invoices";

function parseAmountCents(raw: string | undefined): number | null {
  const cleaned = (raw ?? "").replace(/[^0-9.-]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function parseDate(raw: string | undefined): Date | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseQuoteStatus(raw: string | undefined): TransactionStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.includes("accept")) return TransactionStatus.ACCEPTED;
  if (s.includes("declin") || s.includes("reject")) return TransactionStatus.DECLINED;
  if (s.includes("draft")) return TransactionStatus.DRAFT;
  return TransactionStatus.SENT;
}

function isInvoicePaid(raw: string | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  return s.includes("paid") && !s.includes("unpaid") && !s.includes("partial");
}

function parseInvoiceStatus(raw: string | undefined): TransactionStatus {
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
  // means when it leaves the column blank.
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

/**
 * Find or create the catalogue item a line refers to.
 *
 * Imported history names products by text only, so re-running an import — or
 * importing products first and then quotes — has to land on the same Item
 * rather than growing a second catalogue of near-duplicates.
 */
async function findOrCreateItem(tenantId: string, name: string, unitPriceCents: number) {
  const existing = await prisma.item.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return createProduct({ tenantId, name, unitPriceCents });
}

// Find-or-create by name — bulk imports of historical quotes/invoices
// reference customers by name only, and re-running an import (or importing
// customers first, then invoices) should link to the same Party rather
// than creating duplicates.
async function findOrCreateParty(tenantId: string, name: string, role: PartyRole) {
  const existing = await prisma.party.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return createParty({ tenantId, role, name });
}

interface PendingLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

async function attachLines(tenantId: string, transactionId: string, lines: PendingLine[]) {
  for (const line of lines) {
    const item = await findOrCreateItem(tenantId, line.name, line.unitPriceCents);
    await prisma.transactionLine.create({
      data: {
        transactionId,
        itemId: item.id,
        quantity: line.quantity,
        // Snapshotted from the export rather than read off the catalogue, so
        // importing a two-year-old quote records what was actually charged
        // then, not what the item costs today.
        unitPriceCents: line.unitPriceCents,
      },
    });
  }
}

/**
 * Collapse one-row-per-line-item exports back into documents.
 *
 * Zoho, QuickBooks and the rest repeat the whole document header on every
 * line-item row. Imported row-by-row that produces one near-empty document per
 * line — which is exactly what it did, and why imported quotes arrived with a
 * customer and no items on them.
 *
 * Grouping is by reference where there is one, because that is the document
 * number the source system itself used. Without a reference there is nothing
 * reliable to group on — two genuinely separate same-day quotes to one
 * customer are indistinguishable from two lines of one quote — so each row
 * stays its own document rather than risking silently merging real ones.
 */
function groupRows(records: Record<string, string>[]): {
  headers: Record<string, string>[];
  lines: Map<string, PendingLine[]>;
  keyFor: (record: Record<string, string>, index: number) => string;
} {
  const hasItems = records.some((r) => (r.itemName ?? "").trim());
  const hasReference = records.some((r) => (r.reference ?? "").trim());

  const keyFor = (record: Record<string, string>, index: number) =>
    hasItems && hasReference && (record.reference ?? "").trim()
      ? `ref:${record.reference.trim()}`
      : `row:${index}`;

  const lines = new Map<string, PendingLine[]>();
  const headers: Record<string, string>[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    const key = keyFor(record, index);

    // The first row carrying a given reference supplies the header. Later
    // rows of the same document usually repeat it, and where an export blanks
    // the repeated fields the first row is the one that had them.
    if (!seen.has(key)) {
      seen.add(key);
      headers.push({ ...record, __key: key });
    }

    const name = (record.itemName ?? "").trim();
    if (!name) return;

    const rate = parseAmountCents(record.itemRate);
    const bucket = lines.get(key) ?? [];
    bucket.push({
      name,
      quantity: parseQty(record.itemQuantity),
      unitPriceCents: rate ?? 0,
    });
    lines.set(key, bucket);
  });

  return { headers, lines, keyFor };
}

export async function importRecordsAction(
  tenantId: string,
  target: Target,
  records: Record<string, string>[]
): Promise<ImportResult> {
  const access = await requireTenantAccess(tenantId);
  const capability =
    target === "customers"
      ? "quote:create"
      : target === "products"
        ? "product:manage"
        : target === "quotes"
          ? "quote:create"
          : "invoice:create";
  assertCan(access.role, capability);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const partyRole = tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Documents are grouped; customers and products are genuinely one per row.
  const isDocument = target === "quotes" || target === "invoices";
  const grouped = isDocument ? groupRows(records) : null;
  const groupedLines = grouped?.lines ?? new Map<string, PendingLine[]>();
  const rowsToWalk = grouped ? grouped.headers : records;

  for (const [i, record] of rowsToWalk.entries()) {
    const key = record.__key ?? `row:${i}`;
    try {
      if (target === "customers") {
        const name = record.name?.trim();
        if (!name) {
          skipped++;
          continue;
        }
        await createParty({
          tenantId,
          role: partyRole,
          name,
          phone: record.phone?.trim() || undefined,
        });
      } else if (target === "products") {
        const name = record.name?.trim();
        const unitPriceCents = parseAmountCents(record.unitPriceCents);
        if (!name || unitPriceCents === null) {
          skipped++;
          continue;
        }
        await createProduct({
          tenantId,
          name,
          sku: record.sku?.trim() || undefined,
          category: record.category?.trim() || undefined,
          unitPriceCents,
        });
      } else {
        const customerName = record.customerName?.trim();
        const amountCents = parseAmountCents(record.amountCents);
        if (!customerName || amountCents === null) {
          skipped++;
          continue;
        }
        const party = await findOrCreateParty(tenantId, customerName, partyRole);
        const createdAt = parseDate(record.date);

        if (target === "quotes") {
          const quote = await prisma.transaction.create({
            data: {
              tenantId,
              partyId: party.id,
              type: TransactionType.QUOTE,
              status: parseQuoteStatus(record.status),
              amountCents,
              ...(createdAt ? { createdAt } : {}),
            },
          });
          await attachLines(tenantId, quote.id, groupedLines.get(key) ?? []);
        } else {
          const invoice = await prisma.transaction.create({
            data: {
              tenantId,
              partyId: party.id,
              type: TransactionType.INVOICE,
              status: parseInvoiceStatus(record.status),
              amountCents,
              dueAt: parseDate(record.dueDate),
              ...(createdAt ? { createdAt } : {}),
            },
          });
          // Ledger discipline: a paid historical invoice needs a real PAYMENT
          // row, not just a status flag, so balances/reports derived from the
          // ledger stay correct — recordPayment is the only place that's
          // allowed to write one.
          await attachLines(tenantId, invoice.id, groupedLines.get(key) ?? []);
          if (isInvoicePaid(record.status)) {
            await recordPayment({ invoiceId: invoice.id, amountCents });
          }
        }
      }
      imported++;
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability,
    targetType:
      target === "customers"
        ? "Party"
        : target === "products"
          ? "Item"
          : "Transaction",
    targetId: "bulk-import",
    metadata: { target, imported, skipped, errorCount: errors.length },
  });

  return { imported, skipped, errors };
}
