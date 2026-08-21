// Product/service catalog — the Business Graph API for reusable catalog
// entries. Item already had the right shape (name/sku/price/stock); this
// is what turns it from a one-off row created fresh on every quote into
// an actual reusable catalog the owner builds once and reuses everywhere.

import { prisma } from "@/lib/db";

export interface UpsertProductInput {
  tenantId: string;
  name: string;
  sku?: string;
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
