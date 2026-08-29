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

// Find-or-create by name — bulk imports of historical quotes/invoices
// reference customers by name only, and re-running an import (or importing
// customers first, then invoices) should link to the same Party rather
// than creating duplicates.
async function findOrCreateParty(tenantId: string, name: string, role: PartyRole) {
  const existing = await prisma.party.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return createParty({ tenantId, role, name });
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

  for (const [i, record] of records.entries()) {
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
          await prisma.transaction.create({
            data: {
              tenantId,
              partyId: party.id,
              type: TransactionType.QUOTE,
              status: parseQuoteStatus(record.status),
              amountCents,
              ...(createdAt ? { createdAt } : {}),
            },
          });
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
