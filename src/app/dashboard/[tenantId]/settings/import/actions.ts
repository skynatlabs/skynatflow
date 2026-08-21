"use server";

import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { createProduct } from "@/lib/core/catalog";
import { PartyRole } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importRecordsAction(
  tenantId: string,
  target: "customers" | "products",
  records: Record<string, string>[]
): Promise<ImportResult> {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, target === "customers" ? "quote:create" : "product:manage");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

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
          role: tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER,
          name,
          phone: record.phone?.trim() || undefined,
        });
      } else {
        const name = record.name?.trim();
        const priceRaw = (record.unitPriceCents ?? "").replace(/[^0-9.-]/g, "");
        const price = Number(priceRaw);
        if (!name || !Number.isFinite(price)) {
          skipped++;
          continue;
        }
        await createProduct({
          tenantId,
          name,
          sku: record.sku?.trim() || undefined,
          category: record.category?.trim() || undefined,
          unitPriceCents: Math.round(price * 100),
        });
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
    capability: target === "customers" ? "quote:create" : "product:manage",
    targetType: target === "customers" ? "Party" : "Item",
    targetId: "bulk-import",
    metadata: { imported, skipped, errorCount: errors.length },
  });

  return { imported, skipped, errors };
}
