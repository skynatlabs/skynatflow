// What happened after the warehouse.
//
// A brand sells a container to a distributor and that is the last thing it
// knows. The distributor's own sales — which shops, which lines, which
// weeks — are the distributor's business, and the brand finds out roughly
// nothing until the next order does or does not arrive. This is the single
// largest information gap in African consumer goods, and it is the reason
// Bizom and FieldAssist are worth what they are worth in India.
//
// Nothing here needs new data. A distributor running its books in this app
// already records every outlet sale as an invoice with lines; what has been
// missing is the shape that reads those invoices as a distribution picture
// rather than as revenue:
//
//   PENETRATION — of the shops we could sell this line to, how many do.
//   Universally the first number a brand asks for and the one no African
//   distributor can produce.
//
//   MUST-STOCK GAPS — outlets buying from us that do not carry a line they
//   should. The list a rep works from tomorrow morning.
//
//   DROPPED LINES — an outlet that used to take something and stopped. A
//   lost listing, which is a competitor's win and reads as nothing at all
//   in a revenue report.
//
// ON SHOWING ANY OF THIS TO A BRAND.
//
// This module reports to the distributor about its own trade, and that is
// all it does. Showing outlet-level movement to a third party is a different
// and much more dangerous feature: it is a fact about somebody else's shop,
// and the trading graph already sets the rule this codebase follows — a
// business is told about a counterparty only where both sides have agreed to
// be seen. Nothing here crosses a workspace boundary.

import { TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";

const REAL_INVOICE = {
  type: TransactionType.INVOICE,
  status: { notIn: [TransactionStatus.CANCELLED, TransactionStatus.DRAFT] },
};

interface SoldLine {
  partyId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  valueCents: number;
  at: Date;
}

/** Every outlet sale line in the window, once, so the reports below agree. */
async function soldLines(tenantId: string, since: Date, limit = 20000): Promise<SoldLine[]> {
  const rows = await prisma.transactionLine.findMany({
    where: {
      transaction: { tenantId, createdAt: { gte: since }, ...REAL_INVOICE },
    },
    select: {
      quantity: true,
      unitPriceCents: true,
      itemId: true,
      item: { select: { name: true } },
      transaction: { select: { partyId: true, createdAt: true } },
    },
    orderBy: { transaction: { createdAt: "desc" } },
    take: limit,
  });

  return rows
    .filter((r) => r.transaction.partyId !== null)
    .map((r) => ({
      partyId: r.transaction.partyId as string,
      itemId: r.itemId,
      itemName: r.item.name,
      quantity: r.quantity,
      valueCents: r.quantity * r.unitPriceCents,
      at: r.transaction.createdAt,
    }));
}

export interface PenetrationRow {
  itemId: string;
  name: string;
  outletsBuying: number;
  outletsPossible: number;
  penetrationPercent: number;
  unitsMoved: number;
  valueCents: number;
}

/**
 * Of the shops we sell to, how many take this line.
 *
 * The denominator is outlets that bought ANYTHING in the window, not every
 * outlet on the map. A shop that has not ordered at all is a coverage
 * problem, and counting it here would make every line look weak for a reason
 * that has nothing to do with the line.
 */
export async function penetration(
  tenantId: string,
  sinceDays = 90,
  now = new Date()
): Promise<{ rows: PenetrationRow[]; outletsBuying: number; summary: string }> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  const lines = await soldLines(tenantId, since);

  if (lines.length === 0) {
    return { rows: [], outletsBuying: 0, summary: "Nothing has been sold in this window." };
  }

  const buyingOutlets = new Set(lines.map((l) => l.partyId));
  const byItem = new Map<
    string,
    { name: string; outlets: Set<string>; units: number; value: number }
  >();

  for (const line of lines) {
    const row = byItem.get(line.itemId) ?? {
      name: line.itemName,
      outlets: new Set<string>(),
      units: 0,
      value: 0,
    };
    row.outlets.add(line.partyId);
    row.units += line.quantity;
    row.value += line.valueCents;
    byItem.set(line.itemId, row);
  }

  const rows: PenetrationRow[] = [...byItem.entries()]
    .map(([itemId, r]) => ({
      itemId,
      name: r.name,
      outletsBuying: r.outlets.size,
      outletsPossible: buyingOutlets.size,
      penetrationPercent: Math.round((r.outlets.size / buyingOutlets.size) * 100),
      unitsMoved: r.units,
      valueCents: r.value,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);

  return {
    rows,
    outletsBuying: buyingOutlets.size,
    summary: `${rows.length} lines moved through ${buyingOutlets.size} outlets in ${sinceDays} days.`,
  };
}

export interface StockGap {
  partyId: string;
  outletName: string;
  channel: string | null;
  tier: string | null;
  /** Lines this outlet does not take that most comparable outlets do. */
  missing: Array<{ itemId: string; name: string; carriedByPercent: number }>;
}

/**
 * Shops not carrying something they should.
 *
 * "Should" is defined by what comparable outlets actually do rather than by
 * a must-stock list somebody typed in head office two years ago: a line
 * carried by most outlets in the same channel, and not by this one, is a gap
 * the trade itself has defined.
 *
 * The threshold is deliberately high. A line carried by 40% of shops is a
 * line that half the trade has decided against, and sending a rep to argue
 * about it wastes the call.
 */
export async function mustStockGaps(
  tenantId: string,
  opts: { sinceDays?: number; carriedByAtLeastPercent?: number; now?: Date } = {}
): Promise<StockGap[]> {
  const now = opts.now ?? new Date();
  const threshold = opts.carriedByAtLeastPercent ?? 60;
  const since = new Date(now.getTime() - (opts.sinceDays ?? 90) * 86_400_000);

  const [lines, outlets] = await Promise.all([
    soldLines(tenantId, since),
    prisma.outlet.findMany({
      where: { tenantId, isActive: true },
      select: {
        partyId: true,
        channel: true,
        tier: true,
        party: { select: { name: true } },
      },
      take: 1000,
    }),
  ]);
  if (outlets.length === 0 || lines.length === 0) return [];

  const outletOf = new Map(outlets.map((o) => [o.partyId, o]));
  // Only outlets that are on the map AND bought something: the rest are a
  // coverage problem, not a range problem.
  const relevant = lines.filter((l) => outletOf.has(l.partyId));
  if (relevant.length === 0) return [];

  const carriedBy = new Map<string, { name: string; outlets: Set<string> }>();
  const carriesWhat = new Map<string, Set<string>>();
  const channelOutlets = new Map<string, Set<string>>();

  for (const line of relevant) {
    const outlet = outletOf.get(line.partyId)!;
    const channel = outlet.channel ?? "—";

    const item = carriedBy.get(line.itemId) ?? { name: line.itemName, outlets: new Set<string>() };
    item.outlets.add(line.partyId);
    carriedBy.set(line.itemId, item);

    const mine = carriesWhat.get(line.partyId) ?? new Set<string>();
    mine.add(line.itemId);
    carriesWhat.set(line.partyId, mine);

    const inChannel = channelOutlets.get(channel) ?? new Set<string>();
    inChannel.add(line.partyId);
    channelOutlets.set(channel, inChannel);
  }

  const gaps: StockGap[] = [];

  for (const [partyId, carried] of carriesWhat) {
    const outlet = outletOf.get(partyId)!;
    const channel = outlet.channel ?? "—";
    const peers = channelOutlets.get(channel) ?? new Set<string>();
    // A channel of one has no peers, so it has nothing to be compared to.
    if (peers.size < 3) continue;

    const missing: StockGap["missing"] = [];
    for (const [itemId, item] of carriedBy) {
      if (carried.has(itemId)) continue;
      const peersCarrying = [...item.outlets].filter((p) => peers.has(p)).length;
      const percent = Math.round((peersCarrying / peers.size) * 100);
      if (percent >= threshold) {
        missing.push({ itemId, name: item.name, carriedByPercent: percent });
      }
    }

    if (missing.length > 0) {
      missing.sort((a, b) => b.carriedByPercent - a.carriedByPercent);
      gaps.push({
        partyId,
        outletName: outlet.party.name,
        channel: outlet.channel,
        tier: outlet.tier,
        missing: missing.slice(0, 10),
      });
    }
  }

  return gaps.sort((a, b) => b.missing.length - a.missing.length).slice(0, 200);
}

export interface DroppedLine {
  partyId: string;
  outletName: string;
  itemId: string;
  itemName: string;
  lastBoughtAt: Date;
  daysSince: number;
  /** How often they used to take it, in days between orders. */
  typicalGapDays: number | null;
}

/**
 * A listing that has quietly gone.
 *
 * An outlet that took a line every fortnight for a year and has not taken it
 * for two months has not changed its mind — somebody else is on that shelf.
 * It reads as nothing in a revenue report because the outlet is still
 * buying, just not that.
 */
export async function droppedLines(
  tenantId: string,
  opts: { lookbackDays?: number; now?: Date } = {}
): Promise<DroppedLine[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? 365) * 86_400_000);

  const [lines, outlets] = await Promise.all([
    soldLines(tenantId, since),
    prisma.outlet.findMany({
      where: { tenantId, isActive: true },
      select: { partyId: true, party: { select: { name: true } } },
      take: 1000,
    }),
  ]);
  const outletOf = new Map(outlets.map((o) => [o.partyId, o.party.name]));

  const history = new Map<string, { name: string; itemName: string; dates: Date[] }>();
  for (const line of lines) {
    if (!outletOf.has(line.partyId)) continue;
    const key = `${line.partyId}|${line.itemId}`;
    const row = history.get(key) ?? {
      name: outletOf.get(line.partyId)!,
      itemName: line.itemName,
      dates: [],
    };
    row.dates.push(line.at);
    history.set(key, row);
  }

  const dropped: DroppedLine[] = [];

  for (const [key, row] of history) {
    // Three purchases is the fewest that establishes a habit; two is a
    // coincidence and one is a trial.
    if (row.dates.length < 3) continue;

    const dates = row.dates.map((d) => d.getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
    const typical = gaps.reduce((s, g) => s + g, 0) / gaps.length;

    const last = dates[dates.length - 1];
    const daysSince = (now.getTime() - last) / 86_400_000;

    // Twice the habit, and at least three weeks — so a weekly line has to be
    // missing a fortnight before anybody is told, rather than every Monday.
    if (daysSince > Math.max(typical * 2, 21)) {
      const [partyId, itemId] = key.split("|");
      dropped.push({
        partyId,
        outletName: row.name,
        itemId,
        itemName: row.itemName,
        lastBoughtAt: new Date(last),
        daysSince: Math.floor(daysSince),
        typicalGapDays: Math.round(typical),
      });
    }
  }

  return dropped.sort((a, b) => b.daysSince - a.daysSince).slice(0, 200);
}

export interface ChannelRow {
  channel: string;
  outlets: number;
  valueCents: number;
  sharePercent: number;
}

/** Where the volume actually goes, by kind of shop. */
export async function channelMix(
  tenantId: string,
  sinceDays = 90,
  now = new Date()
): Promise<ChannelRow[]> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  const [lines, outlets] = await Promise.all([
    soldLines(tenantId, since),
    prisma.outlet.findMany({
      where: { tenantId, isActive: true },
      select: { partyId: true, channel: true },
      take: 1000,
    }),
  ]);

  const channelOf = new Map(outlets.map((o) => [o.partyId, o.channel ?? "Unclassified"]));
  const byChannel = new Map<string, { outlets: Set<string>; value: number }>();

  for (const line of lines) {
    const channel = channelOf.get(line.partyId);
    if (!channel) continue;
    const row = byChannel.get(channel) ?? { outlets: new Set<string>(), value: 0 };
    row.outlets.add(line.partyId);
    row.value += line.valueCents;
    byChannel.set(channel, row);
  }

  const total = [...byChannel.values()].reduce((s, r) => s + r.value, 0);

  return [...byChannel.entries()]
    .map(([channel, r]) => ({
      channel,
      outlets: r.outlets.size,
      valueCents: r.value,
      sharePercent: total === 0 ? 0 : Math.round((r.value / total) * 100),
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
}
