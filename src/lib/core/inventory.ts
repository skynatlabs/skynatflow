// AI inventory optimization — deliberately just statistics, not an LLM
// call. Demand velocity, classification, and reorder sizing are all
// computed straight from the ledger data every tenant already has
// (TransactionLine/Item), which is the actual advantage over a generic
// tool: the data's already structured and unified, so no separate
// "connect your sales data" step is needed to make this work.

import { prisma } from "@/lib/db";

export type DemandClass = "fast" | "slow" | "dead" | "unrated";

export interface DemandRow {
  itemId: string;
  name: string;
  sku: string | null;
  stockQty: number | null;
  reorderPoint: number | null;
  unitsPerWeek: number;
  trendUnitsPerWeek: number; // prior 30d window, for comparison
  weeksOfCover: number | null; // null = infinite (no velocity) or not stock-tracked
  demandClass: DemandClass;
}

const RECENT_WINDOW_DAYS = 30;
const PRIOR_WINDOW_DAYS = 30; // the 30 days before the recent window

async function unitsSoldInWindow(tenantId: string, from: Date, to: Date) {
  const lines = await prisma.transactionLine.findMany({
    where: {
      item: { tenantId },
      transaction: { type: "INVOICE", status: "PAID", createdAt: { gte: from, lt: to } },
    },
    select: { itemId: true, quantity: true },
  });
  const byItem = new Map<string, number>();
  for (const l of lines) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + l.quantity);
  return byItem;
}

function classify(weeksOfCover: number | null, unitsPerWeek: number): DemandClass {
  if (unitsPerWeek <= 0) return weeksOfCover === null ? "unrated" : "dead";
  if (weeksOfCover !== null && weeksOfCover < 2) return "fast";
  if (weeksOfCover !== null && weeksOfCover > 12) return "slow";
  return unitsPerWeek > 0 ? "fast" : "slow";
}

// Ranked hottest→coldest — this is the "SKU heat map."
export async function getDemandHeatmap(tenantId: string): Promise<DemandRow[]> {
  const now = new Date();
  const recentStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * 86400000);
  const priorStart = new Date(recentStart.getTime() - PRIOR_WINDOW_DAYS * 86400000);

  const [items, recentUnits, priorUnits] = await Promise.all([
    prisma.item.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" } }),
    unitsSoldInWindow(tenantId, recentStart, now),
    unitsSoldInWindow(tenantId, priorStart, recentStart),
  ]);

  const rows: DemandRow[] = items.map((item) => {
    const recentTotal = recentUnits.get(item.id) ?? 0;
    const priorTotal = priorUnits.get(item.id) ?? 0;
    const unitsPerWeek = recentTotal / (RECENT_WINDOW_DAYS / 7);
    const trendUnitsPerWeek = priorTotal / (PRIOR_WINDOW_DAYS / 7);
    const weeksOfCover =
      item.stockQty != null && unitsPerWeek > 0 ? item.stockQty / unitsPerWeek : null;

    return {
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      stockQty: item.stockQty,
      reorderPoint: item.reorderPoint,
      unitsPerWeek,
      trendUnitsPerWeek,
      weeksOfCover,
      demandClass: classify(weeksOfCover, unitsPerWeek),
    };
  });

  return rows.sort((a, b) => b.unitsPerWeek - a.unitsPerWeek);
}

export interface ReorderSuggestion {
  itemId: string;
  name: string;
  sku: string | null;
  stockQty: number;
  reorderPoint: number;
  unitsPerWeek: number;
  suggestedQty: number;
}

// Items at/under their reorder point, sized to actual recent demand
// instead of a static number someone guessed once — the "auto-order
// high-demand items when running out" ask, minus actually placing a
// purchase order (no supplier/procurement flow exists yet; this is the
// suggestion surfaced for the owner to act on).
export async function getReorderSuggestions(
  tenantId: string,
  leadTimeDays = 14
): Promise<ReorderSuggestion[]> {
  const heatmap = await getDemandHeatmap(tenantId);
  return heatmap
    .filter(
      (row): row is DemandRow & { stockQty: number; reorderPoint: number } =>
        row.stockQty != null && row.reorderPoint != null && row.stockQty <= row.reorderPoint
    )
    .map((row) => ({
      itemId: row.itemId,
      name: row.name,
      sku: row.sku,
      stockQty: row.stockQty,
      reorderPoint: row.reorderPoint,
      unitsPerWeek: row.unitsPerWeek,
      suggestedQty: Math.max(
        row.reorderPoint,
        Math.ceil(row.unitsPerWeek * (leadTimeDays / 7) * 1.2) // 20% buffer over lead-time demand
      ),
    }))
    .sort((a, b) => b.unitsPerWeek - a.unitsPerWeek);
}

export async function recordBatch(params: {
  tenantId: string;
  itemId: string;
  quantity: number;
  expiresAt?: Date | null;
}) {
  return prisma.itemBatch.create({
    data: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      quantity: params.quantity,
      expiresAt: params.expiresAt ?? null,
    },
  });
}

export interface ExpiryRiskRow {
  batchId: string;
  itemId: string;
  name: string;
  sku: string | null;
  quantity: number;
  expiresAt: Date;
  daysUntilExpiry: number;
}

// Batches expiring soon — the "minimize shelf life waste" ask. Sorted
// most-urgent first so a markdown/clearance decision can be made before
// it's a full write-off.
export async function getExpiryRisk(tenantId: string, withinDays = 14): Promise<ExpiryRiskRow[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86400000);

  const batches = await prisma.itemBatch.findMany({
    where: { tenantId, expiresAt: { not: null, lte: cutoff } },
    include: { item: true },
    orderBy: { expiresAt: "asc" },
  });

  return batches.map((b) => ({
    batchId: b.id,
    itemId: b.itemId,
    name: b.item.name,
    sku: b.item.sku,
    quantity: b.quantity,
    expiresAt: b.expiresAt!,
    daysUntilExpiry: Math.ceil((b.expiresAt!.getTime() - now.getTime()) / 86400000),
  }));
}
