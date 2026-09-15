// Product/service catalog — the Business Graph API for reusable catalog
// entries. Item already had the right shape (name/sku/price/stock); this
// is what turns it from a one-off row created fresh on every quote into
// an actual reusable catalog the owner builds once and reuses everywhere.

import { prisma } from "@/lib/db";

export interface UpsertProductInput {
  tenantId: string;
  name: string;
  sku?: string;
  hsnCode?: string;
  unitPriceCents: number;
  costCents?: number;
  taxRatePercent?: number;
  category?: string;
  imageUrl?: string;
  stockQty?: number;
  reorderPoint?: number;
}

export async function createProduct(input: UpsertProductInput) {
  return prisma.item.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      sku: input.sku,
      hsnCode: input.hsnCode,
      unitPriceCents: input.unitPriceCents,
      costCents: input.costCents,
      taxRatePercent: input.taxRatePercent,
      category: input.category,
      imageUrl: input.imageUrl,
      stockQty: input.stockQty,
      reorderPoint: input.reorderPoint,
    },
  });
}

export async function updateProduct(
  productId: string,
  input: Partial<UpsertProductInput>
) {
  return prisma.item.update({
    where: { id: productId },
    data: {
      name: input.name,
      sku: input.sku,
      hsnCode: input.hsnCode,
      unitPriceCents: input.unitPriceCents,
      costCents: input.costCents,
      taxRatePercent: input.taxRatePercent,
      category: input.category,
      imageUrl: input.imageUrl,
      stockQty: input.stockQty,
      reorderPoint: input.reorderPoint,
    },
  });
}

export async function setProductActive(productId: string, isActive: boolean) {
  return prisma.item.update({ where: { id: productId }, data: { isActive } });
}

export async function listProducts(tenantId: string, includeInactive = false) {
  return prisma.item.findMany({
    where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: "asc" },
  });
}

const PRODUCTS_PAGE_SIZE = 25;

export async function listProductsPaginated(tenantId: string, page = 1, includeInactive = true) {
  const where = { tenantId, ...(includeInactive ? {} : { isActive: true }) };
  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PRODUCTS_PAGE_SIZE,
      take: PRODUCTS_PAGE_SIZE,
    }),
    prisma.item.count({ where }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE)) };
}

export async function searchProducts(tenantId: string, query: string) {
  if (!query.trim()) return listProducts(tenantId);
  return prisma.item.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 10,
  });
}

// ------------------------------------------------------------ live search

export interface CatalogHit {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  unitPriceCents: number;
  costCents: number | null;
  taxRatePercent: number | null;
  stockQty: number | null;
  category: string | null;
}

const HIT_SELECT = {
  id: true, name: true, sku: true, description: true, unit: true,
  unitPriceCents: true, costCents: true, taxRatePercent: true, stockQty: true, category: true,
} as const;

/**
 * Live search for the item field on a quote or invoice.
 *
 * Every word typed has to appear somewhere — name, SKU, description or
 * category — so "8kva inverter" finds "Deye 8kVA Hybrid Inverter". Results
 * starting with what was typed come first. With nothing typed, the items
 * this business has put on documents most in the last ninety days, because
 * that is almost always what is about to be picked again.
 *
 * Replaces shipping the whole catalogue to every quote form, which for a
 * wholesaler with five thousand lines was a slow page and a scrolling list.
 */
export async function searchCatalog(tenantId: string, raw: string, limit = 12): Promise<CatalogHit[]> {
  const q = raw.trim();
  if (!q) {
    const recent = await prisma.transactionLine.groupBy({
      by: ["itemId"],
      where: { transaction: { tenantId, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, item: { isActive: true } },
      _count: { itemId: true },
      orderBy: { _count: { itemId: "desc" } },
      take: limit,
    });
    if (recent.length > 0) {
      const items = await prisma.item.findMany({ where: { tenantId, id: { in: recent.map((r) => r.itemId) } }, select: HIT_SELECT });
      const byId = new Map(items.map((i) => [i.id, i]));
      return recent.map((r) => byId.get(r.itemId)).filter((i): i is CatalogHit => Boolean(i));
    }
    return prisma.item.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, take: limit, select: HIT_SELECT });
  }

  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const rows = await prisma.item.findMany({
    where: {
      tenantId,
      isActive: true,
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w, mode: "insensitive" as const } },
          { sku: { contains: w, mode: "insensitive" as const } },
          { description: { contains: w, mode: "insensitive" as const } },
          { category: { contains: w, mode: "insensitive" as const } },
        ],
      })),
    },
    select: HIT_SELECT,
    take: 60,
  });
  const lower = q.toLowerCase();
  const rank = (i: CatalogHit) =>
    (i.sku?.toLowerCase() === lower ? 0 : 10) +
    (i.name.toLowerCase().startsWith(lower) ? 0 : 5) +
    (i.name.toLowerCase().includes(lower) ? 0 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface CatalogPatch {
  name?: string;
  description?: string | null;
  sku?: string | null;
  unit?: string | null;
  unitPriceCents?: number;
  costCents?: number | null;
  taxRatePercent?: number | null;
}

/**
 * Edit a catalogue item from wherever it is being used. Scoped to the
 * workspace: an id from somewhere else is refused rather than updated.
 * The change applies to the catalogue from now on; documents already sent
 * keep the price and tax they were issued with.
 */
export async function updateCatalogItem(tenantId: string, itemId: string, patch: CatalogPatch): Promise<CatalogHit> {
  const existing = await prisma.item.findFirst({ where: { id: itemId, tenantId }, select: { id: true } });
  if (!existing) throw new Error("Product not found.");
  if (patch.name !== undefined && !patch.name.trim()) throw new Error("A product needs a name.");
  if (patch.unitPriceCents !== undefined && (!Number.isFinite(patch.unitPriceCents) || patch.unitPriceCents < 0)) {
    throw new Error("The price cannot be negative.");
  }
  if (patch.taxRatePercent !== undefined && patch.taxRatePercent !== null && (patch.taxRatePercent < 0 || patch.taxRatePercent > 100)) {
    throw new Error("A tax rate is between 0 and 100.");
  }
  return prisma.item.update({
    where: { id: itemId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.sku !== undefined ? { sku: patch.sku?.trim() || null } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit?.trim() || null } : {}),
      ...(patch.unitPriceCents !== undefined ? { unitPriceCents: Math.round(patch.unitPriceCents) } : {}),
      ...(patch.costCents !== undefined ? { costCents: patch.costCents === null ? null : Math.round(patch.costCents) } : {}),
      ...(patch.taxRatePercent !== undefined ? { taxRatePercent: patch.taxRatePercent === null ? null : Math.round(patch.taxRatePercent) } : {}),
    },
    select: HIT_SELECT,
  });
}
