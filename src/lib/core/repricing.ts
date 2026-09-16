// Cost-rise repricing — the margin you think you have versus the margin you
// actually have.
//
// Every business here already holds both numbers and never compares them. The
// catalogue carries a cost that was typed in once; purchase orders carry what
// the supplier has charged since. When a supplier puts prices up nobody
// rewrites the catalogue, so the margin report keeps quoting the old figure
// and the business goes on selling at a price that was set against a cost it
// no longer pays. It is invisible precisely because both halves are correct
// on their own.
//
// The target margin is not a number this module invents. It is the margin the
// item was ORIGINALLY priced at — list price against catalogue cost — because
// that is a decision somebody actually made. Restoring it is a defensible
// suggestion in a way that "aim for 30%" never is.

import { prisma } from "@/lib/db";
import { tenantCurrency } from "./currency";
import { formatMoney } from "@/lib/format/money";

export interface RepricingLine {
  itemId: string;
  name: string;
  sku: string | null;
  unitPriceCents: number;
  /** What the catalogue believes the item costs. */
  catalogueCostCents: number;
  /** What the most recent purchase order actually paid. */
  latestPaidCents: number;
  latestPaidAt: Date;
  /** How far the real cost has moved above the catalogue figure. */
  costMovePercent: number;
  /** Margin against what is actually being paid — the true one. */
  marginNowPercent: number;
  /** Margin against the catalogue cost — the one every report is quoting. */
  marginAssumedPercent: number;
  /** The price that would restore the margin this item was originally priced at. */
  suggestedPriceCents: number;
  /** Selling below what it costs to buy. Rare, expensive, and always a surprise. */
  sellingAtALoss: boolean;
  /** One sentence explaining where these numbers came from. */
  basis: string;
}

export interface RepricingReport {
  lines: RepricingLine[];
  summary: string;
  /** What this cannot see. Stated rather than implied, so the numbers are not over-trusted. */
  caveats: string[];
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Takes the currency rather than assuming one: these sentences are read by
// the owner, and an owner in Ohio reading rands stops trusting the number.
function money(cents: number, currency: string): string {
  return formatMoney(cents, currency, { decimals: true });
}

/**
 * Items whose real cost has moved away from the catalogue.
 *
 * `minMovePercent` filters out the noise of a rounding difference or a single
 * small delivery charge — a 0.4% move is not a repricing decision, and a list
 * full of them teaches people to close the page.
 */
export async function findCostRises(
  tenantId: string,
  opts: { minMovePercent?: number } = {}
): Promise<RepricingReport> {
  const minMove = opts.minMovePercent ?? 2;
  const currency = await tenantCurrency(tenantId);

  // Only received orders. What a supplier quoted on a draft is not evidence
  // of what the business is paying.
  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: { tenantId, receivedAt: { not: null } },
      item: { tenantId, isActive: true },
    },
    select: {
      unitCostCents: true,
      itemId: true,
      purchaseOrder: { select: { receivedAt: true } },
      item: {
        select: { id: true, name: true, sku: true, unitPriceCents: true, costCents: true },
      },
    },
    orderBy: { purchaseOrder: { receivedAt: "desc" } },
  });

  // Most recent received price per item. The list is already sorted newest
  // first, so the first sighting of an item is the latest one.
  const latest = new Map<string, { cents: number; at: Date; item: (typeof lines)[number]["item"] }>();
  for (const l of lines) {
    if (latest.has(l.itemId)) continue;
    const at = l.purchaseOrder.receivedAt;
    if (!at) continue;
    latest.set(l.itemId, { cents: l.unitCostCents, at, item: l.item });
  }

  const out: RepricingLine[] = [];

  for (const [itemId, seen] of latest) {
    const item = seen.item;
    // An item with no recorded cost has no original margin to restore, so
    // there is nothing honest to suggest. Skipped rather than guessed at.
    if (!item.costCents || item.costCents <= 0) continue;
    if (item.unitPriceCents <= 0) continue;

    const move = pct(seen.cents - item.costCents, item.costCents);
    if (move < minMove) continue;

    const marginAssumed = pct(item.unitPriceCents - item.costCents, item.unitPriceCents);
    const marginNow = pct(item.unitPriceCents - seen.cents, item.unitPriceCents);

    // Price that restores the original margin against the cost actually
    // being paid. At a 100% assumed margin this would divide by zero, which
    // cannot happen for a real item but is guarded anyway.
    const retained = 1 - marginAssumed / 100;
    const suggested =
      retained > 0 ? Math.ceil(seen.cents / retained) : item.unitPriceCents;

    out.push({
      itemId,
      name: item.name,
      sku: item.sku,
      unitPriceCents: item.unitPriceCents,
      catalogueCostCents: item.costCents,
      latestPaidCents: seen.cents,
      latestPaidAt: seen.at,
      costMovePercent: move,
      marginNowPercent: marginNow,
      marginAssumedPercent: marginAssumed,
      suggestedPriceCents: suggested,
      sellingAtALoss: seen.cents >= item.unitPriceCents,
      basis:
        `Catalogue cost ${money(item.costCents, currency)}, last actually paid ${money(seen.cents, currency)} on ` +
        `${seen.at.toISOString().slice(0, 10)}. Selling at ${money(item.unitPriceCents, currency)} that is ` +
        `${marginNow}% margin, not the ${marginAssumed}% the catalogue reports.`,
    });
  }

  // Worst first: losses, then the biggest margin erosion.
  out.sort(
    (a, b) =>
      Number(b.sellingAtALoss) - Number(a.sellingAtALoss) ||
      a.marginNowPercent - b.marginNowPercent
  );

  return { lines: out, summary: summarise(out, currency), caveats: caveatsFor(out) };
}

function summarise(lines: RepricingLine[], currency: string): string {
  if (lines.length === 0) return "";

  const losses = lines.filter((l) => l.sellingAtALoss);
  if (losses.length > 0) {
    const worst = losses[0];
    return (
      `${worst.name} now costs ${money(worst.latestPaidCents, currency)} and sells for ` +
      `${money(worst.unitPriceCents, currency)} — every one sold loses money.` +
      (losses.length > 1 ? ` ${losses.length - 1} other item${losses.length === 2 ? "" : "s"} the same.` : "")
    );
  }

  const worst = lines[0];
  return (
    `${lines.length} item${lines.length === 1 ? "" : "s"} cost more than the catalogue says. ` +
    `Worst is ${worst.name}: ${worst.marginNowPercent}% margin, not the ` +
    `${worst.marginAssumedPercent}% being reported.`
  );
}

function caveatsFor(lines: RepricingLine[]): string[] {
  const caveats = [
    "Compares the last received purchase order price against the cost stored on the catalogue. " +
      "A one-off rush order or a small delivery will look like a permanent rise.",
    "Items with no recorded cost are left out entirely — there is no original margin to restore.",
  ];
  if (lines.some((l) => l.sellingAtALoss)) {
    caveats.push(
      "Items marked as selling at a loss may be deliberate — a loss leader, or a contract price " +
        "agreed before the cost moved."
    );
  }
  return caveats;
}

/**
 * Apply a suggested price.
 *
 * Deliberately one item at a time and deliberately not automatic. Repricing is
 * a commercial decision with a customer on the other end of it, and the point
 * of this module is to put the decision in front of somebody, not to take it.
 */
export async function applySuggestedPrice(params: {
  tenantId: string;
  itemId: string;
  unitPriceCents: number;
  /** Also bring the catalogue cost up to what is actually being paid. */
  alsoUpdateCost?: number;
}) {
  const item = await prisma.item.findUnique({
    where: { id: params.itemId },
    select: { tenantId: true },
  });
  if (!item || item.tenantId !== params.tenantId) throw new Error("Product not found.");
  if (params.unitPriceCents <= 0) throw new Error("A price has to be more than nothing.");

  return prisma.item.update({
    where: { id: params.itemId },
    data: {
      unitPriceCents: params.unitPriceCents,
      ...(params.alsoUpdateCost && params.alsoUpdateCost > 0
        ? { costCents: params.alsoUpdateCost }
        : {}),
    },
  });
}
