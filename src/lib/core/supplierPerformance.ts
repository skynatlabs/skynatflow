// Supplier performance — the pattern a person lives through and never sees.
//
// Nobody notices that one supplier has taken eleven days instead of four for
// the last six orders, because each order was individually fine and each delay
// had a reason. The same is true of a price that has crept up three times in a
// year: every single rise was small and explicable, and the cumulative one is
// neither.
//
// This reads purchase orders that already exist. No new data is collected and
// nothing is scored out of ten — a supplier is compared against their own past
// behaviour and against the other suppliers this business actually uses, which
// are the only two comparisons that mean anything at this size.

import { prisma } from "@/lib/db";

export interface SupplierStat {
  supplierId: string;
  name: string;
  ordersPlaced: number;
  ordersReceived: number;
  /** Sent but never marked received. Usually means it never arrived, sometimes that nobody logged it. */
  outstanding: number;
  /** Median days from sending an order to receiving it. Null when nothing has completed. */
  medianLeadDays: number | null;
  /** Their slowest completed delivery, which is what capacity planning has to survive. */
  worstLeadDays: number | null;
  totalSpentCents: number;
  /** Percentage change between the earliest and latest unit price, averaged over repeated items. */
  priceDriftPercent: number | null;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** Plain-language observations. Empty when there is nothing notable. */
  flags: string[];
}

export interface SupplierReport {
  suppliers: SupplierStat[];
  summary: string;
  caveats: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/**
 * Every supplier this business has actually ordered from.
 *
 * Median rather than mean lead time throughout: one order held up by a
 * three-week import delay would drag a mean far enough to make a reliable
 * supplier look unreliable, and the question being asked is "what usually
 * happens", which is what a median answers.
 */
export async function supplierPerformance(tenantId: string): Promise<SupplierReport> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { tenantId },
    select: {
      id: true,
      supplierId: true,
      status: true,
      totalCostCents: true,
      createdAt: true,
      sentAt: true,
      receivedAt: true,
      supplier: { select: { id: true, name: true } },
      lines: { select: { itemId: true, unitCostCents: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  type Bucket = {
    name: string;
    placed: number;
    received: number;
    outstanding: number;
    leadDays: number[];
    spentCents: number;
    first: Date | null;
    last: Date | null;
    // itemId -> unit costs in chronological order, for drift.
    prices: Map<string, number[]>;
  };

  const buckets = new Map<string, Bucket>();

  for (const o of orders) {
    let b = buckets.get(o.supplierId);
    if (!b) {
      b = {
        name: o.supplier.name,
        placed: 0,
        received: 0,
        outstanding: 0,
        leadDays: [],
        spentCents: 0,
        first: null,
        last: null,
        prices: new Map(),
      };
      buckets.set(o.supplierId, b);
    }

    // A draft was never placed with anyone, so it says nothing about the
    // supplier and is skipped rather than counted against them.
    if (o.status === "DRAFT") continue;

    b.placed += 1;
    b.spentCents += o.totalCostCents;
    b.first ??= o.createdAt;
    b.last = o.createdAt;

    if (o.receivedAt) {
      b.received += 1;
      // Measured from when it was sent, not raised — time spent sitting in
      // our own drafts folder is not the supplier's fault.
      b.leadDays.push(daysBetween(o.sentAt ?? o.createdAt, o.receivedAt));
    } else if (o.sentAt) {
      b.outstanding += 1;
    }

    for (const line of o.lines) {
      const series = b.prices.get(line.itemId) ?? [];
      series.push(line.unitCostCents);
      b.prices.set(line.itemId, series);
    }
  }

  const stats: SupplierStat[] = [];

  for (const [supplierId, b] of buckets) {
    if (b.placed === 0) continue;

    const med = median(b.leadDays);
    const worst = b.leadDays.length > 0 ? Math.max(...b.leadDays) : null;

    // Drift across every item ordered more than once from this supplier,
    // averaged. A single item's rise is anecdote; the average across a
    // basket is a pattern.
    const drifts: number[] = [];
    for (const series of b.prices.values()) {
      if (series.length < 2) continue;
      const firstPrice = series[0];
      const lastPrice = series[series.length - 1];
      if (firstPrice <= 0) continue;
      drifts.push(((lastPrice - firstPrice) / firstPrice) * 100);
    }
    const drift =
      drifts.length > 0
        ? Math.round((drifts.reduce((a, c) => a + c, 0) / drifts.length) * 10) / 10
        : null;

    stats.push({
      supplierId,
      name: b.name,
      ordersPlaced: b.placed,
      ordersReceived: b.received,
      outstanding: b.outstanding,
      medianLeadDays: med,
      worstLeadDays: worst,
      totalSpentCents: b.spentCents,
      priceDriftPercent: drift,
      firstOrderAt: b.first,
      lastOrderAt: b.last,
      flags: flagsFor({ med, worst, drift, outstanding: b.outstanding, placed: b.placed }),
    });
  }

  // Most money first — that is where a week of delay or a 9% drift costs most.
  stats.sort((a, b) => b.totalSpentCents - a.totalSpentCents);

  return { suppliers: stats, summary: summarise(stats), caveats: caveatsFor(stats) };
}

function flagsFor(input: {
  med: number | null;
  worst: number | null;
  drift: number | null;
  outstanding: number;
  placed: number;
}): string[] {
  const flags: string[] = [];

  if (input.outstanding > 0) {
    flags.push(
      `${input.outstanding} order${input.outstanding === 1 ? "" : "s"} sent and never marked received.`
    );
  }
  if (input.drift !== null && input.drift >= 5) {
    flags.push(`Prices up ${input.drift}% on average since you first ordered.`);
  }
  if (input.drift !== null && input.drift <= -5) {
    flags.push(`Prices down ${Math.abs(input.drift)}% since you first ordered.`);
  }
  // Unreliability is the gap between the usual and the worst, not slowness
  // itself. A supplier who always takes ten days is plannable; one who takes
  // three days and then sixteen is not.
  if (input.med !== null && input.worst !== null && input.worst >= input.med * 3 && input.worst - input.med >= 5) {
    flags.push(`Usually ${input.med} days, but has taken ${input.worst} — hard to plan around.`);
  }

  return flags;
}

function summarise(stats: SupplierStat[]): string {
  if (stats.length === 0) return "";

  const flagged = stats.filter((s) => s.flags.length > 0);
  if (flagged.length === 0) {
    return `${stats.length} supplier${stats.length === 1 ? "" : "s"}, nothing out of the ordinary.`;
  }

  const worst = flagged[0];
  return `${worst.name}: ${worst.flags[0]}${
    flagged.length > 1 ? ` ${flagged.length - 1} other supplier${flagged.length === 2 ? "" : "s"} flagged.` : ""
  }`;
}

function caveatsFor(stats: SupplierStat[]): string[] {
  const caveats = [
    "Lead time is measured from when an order was sent to when it was marked received, so it " +
      "reflects how promptly deliveries get logged as much as how promptly they arrive.",
    "Draft orders are ignored — they were never placed with anyone.",
  ];
  if (stats.some((s) => s.ordersPlaced < 3)) {
    caveats.push(
      "Suppliers with only one or two orders are shown, but two data points are not a pattern."
    );
  }
  return caveats;
}
