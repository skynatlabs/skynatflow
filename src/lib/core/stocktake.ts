// Stocktake / shrinkage variance — expected (system) vs counted (physical)
// stock, made visible per item and per who counted it, instead of only
// discovered months later as an unexplained margin gap.

import { prisma } from "@/lib/db";

export async function recordStocktake(params: {
  tenantId: string;
  itemId: string;
  countedQty: number;
  countedById: string;
}) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: params.itemId } });
  const expectedQty = item.stockQty ?? 0;

  const stocktake = await prisma.stocktake.create({
    data: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      expectedQty,
      countedQty: params.countedQty,
      countedById: params.countedById,
    },
  });

  // The counted number becomes the new source of truth for on-hand stock —
  // a physical count should always win over what the ledger assumed.
  await prisma.item.update({
    where: { id: params.itemId },
    data: { stockQty: params.countedQty },
  });

  return stocktake;
}

export interface ShrinkageRow {
  stocktakeId: string;
  itemId: string;
  itemName: string;
  expectedQty: number;
  countedQty: number;
  varianceQty: number;
  countedByName: string;
  createdAt: Date;
}

export async function getShrinkageReport(tenantId: string): Promise<ShrinkageRow[]> {
  // Filtering expected!=counted happens in JS below — Prisma can't compare
  // two columns of the same row directly in a `where` clause.
  const all = await prisma.stocktake.findMany({
    where: { tenantId },
    include: { item: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const stocktakes = all.filter((s) => s.expectedQty !== s.countedQty);

  const memberships = await prisma.membership.findMany({
    where: { id: { in: stocktakes.map((s) => s.countedById) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));

  return stocktakes.map((s) => ({
    stocktakeId: s.id,
    itemId: s.itemId,
    itemName: s.item.name,
    expectedQty: s.expectedQty,
    countedQty: s.countedQty,
    varianceQty: s.countedQty - s.expectedQty,
    countedByName: nameById.get(s.countedById) ?? "Someone",
    createdAt: s.createdAt,
  }));
}
