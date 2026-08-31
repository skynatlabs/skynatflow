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
