"use server";

import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createProduct } from "@/lib/core/catalog";
import { importDocuments, adoptExistingReferences, parseAmountCents } from "@/lib/import/documents";
import { PartyRole } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  /** Documents already here that arrived empty and now have their lines. */
  repaired?: number;
  /** Documents already here and complete — not duplicated. */
  alreadyHere?: number;
  /** Imported with no line items: the export's item columns were not mapped. */
  withoutLines?: number;
}

type Target = "customers" | "products" | "quotes" | "invoices";

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
  assertCan(access, capability);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const partyRole = tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER;

  let result: ImportResult;
  if (target === "quotes" || target === "invoices") {
    // Documents imported before their source number was kept are linked to
    // it first, so this run fills in their missing lines instead of
    // creating a second copy of each.
    await adoptExistingReferences({ tenantId, target, records });
    result = await importDocuments({ tenantId, target, records, partyRole });
  } else {
    result = { imported: 0, skipped: 0, errors: [] };
    for (const [i, record] of records.entries()) {
      try {
        if (target === "customers") {
          const name = record.name?.trim();
          if (!name) {
            result.skipped++;
            continue;
          }
          await createParty({ tenantId, role: partyRole, name, phone: record.phone?.trim() || undefined });
        } else {
          const name = record.name?.trim();
          const unitPriceCents = parseAmountCents(record.unitPriceCents);
          if (!name || unitPriceCents === null) {
            result.skipped++;
            continue;
          }
          await createProduct({
            tenantId,
            name,
            sku: record.sku?.trim() || undefined,
            category: record.category?.trim() || undefined,
            unitPriceCents,
          });
        }
        result.imported++;
      } catch (err) {
        result.errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }
  }

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability,
    targetType: target === "customers" ? "Party" : target === "products" ? "Item" : "Transaction",
    targetId: "bulk-import",
    metadata: { target, imported: result.imported, skipped: result.skipped, repaired: result.repaired ?? 0, errorCount: result.errors.length },
  });

  return result;
}
