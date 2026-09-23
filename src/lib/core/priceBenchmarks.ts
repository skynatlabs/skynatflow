// What everybody else is paying for the same thing.
//
// Price intelligence, as sold everywhere else, means scraping competitors'
// websites. That is the wrong product for this market twice over: most of
// the trade here has no website to scrape, and scraping the ones that do is
// a legal argument waiting to happen.
//
// The version that works is the one only a platform can build. Hundreds of
// businesses on this system are buying the same cement, the same tyres, the
// same 500ml cola from the same handful of wholesalers, and every one of
// them believes their supplier price is roughly normal because they have
// never seen anybody else's. A distributor quoting one retailer 12% more
// than the shop across the road is not doing anything unusual — it is doing
// what happens when nobody can compare.
//
// So: what are businesses like yours actually PAYING for this, from their
// own purchase records. Not a list price, not an advertised price — the
// price that was really charged.
//
// THE PRIVACY RULES ARE THE SAME ONES, AND THEY ARE NOT NEGOTIABLE.
//
// This reuses the benchmark opt-in and the floor of five contributing
// businesses, deliberately, because the failure mode here is worse than in a
// margin benchmark: a supplier's price to a named customer is commercially
// sensitive to two parties, not one. A cohort of three is one wholesaler
// reading another's deal.
//
// Matching is on the product NAME, normalised. That is imprecise and it is
// stated as imprecise: "Portland cement 42.5N 50kg" and "Cement PPC 50kg"
// are the same thing to a builder and not to a string comparison. Rather
// than pretend otherwise, every row says how many distinct businesses and
// how many purchases stand behind it, so a thin match reads as thin.

import { prisma } from "@/lib/db";

/** Below this, a cohort is a handful of businesses that could be named. */
export const PRICE_COHORT_FLOOR = 5;

/** A name shorter than this matches too much to mean anything. */
const MIN_KEY_LENGTH = 6;

/**
 * Reduce a product name to something two businesses would both write.
 *
 * Keeps digits, because a size is usually the difference between two
 * products with the same words ("cement 50kg" and "cement 25kg").
 */
export function productKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1)
    .sort()
    .join(" ")
    .trim();
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

export interface PriceComparison {
  itemId: string;
  name: string;
  /** What this business last paid, per unit. */
  yoursCents: number;
  medianCents: number;
  lowerQuartileCents: number;
  upperQuartileCents: number;
  /** How many other businesses stand behind the comparison. Never below the floor. */
  cohort: number;
  purchases: number;
  /** Positive means paying more than the middle. */
  differenceCents: number;
  differencePercent: number;
  /** What a year at the median instead would be worth, at this buying rate. */
  couldSaveCentsPerYear: number;
}

export interface PriceBenchmarkResult {
  optedIn: boolean;
  rows: PriceComparison[];
  /** Lines with no usable cohort, so the silence is explained rather than odd. */
  notEnoughData: string[];
  totalCouldSaveCentsPerYear: number;
  summary: string;
}

/**
 * What this business pays, against what comparable businesses pay.
 *
 * Reads purchase order lines rather than the catalogue: a catalogue cost is
 * what somebody typed once, and the whole point here is what was actually
 * charged.
 */
export async function priceBenchmarks(
  tenantId: string,
  opts: { sinceDays?: number; now?: Date } = {}
): Promise<PriceBenchmarkResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 180) * 86_400_000);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { benchmarksOptedIn: true },
  });
  if (!tenant?.benchmarksOptedIn) {
    return {
      optedIn: false,
      rows: [],
      notEnoughData: [],
      totalCouldSaveCentsPerYear: 0,
      summary:
        "This workspace has not opted into benchmarking. Nothing of yours is shared and nothing of anybody else's is shown.",
    };
  }

  // Every purchase line across every opted-in workspace, in the window. The
  // tenantId is carried only to count distinct businesses and to separate
  // "yours" from "theirs"; nothing identifying is returned.
  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: {
        createdAt: { gte: since },
        tenant: { benchmarksOptedIn: true },
      },
      quantity: { gt: 0 },
      unitCostCents: { gt: 0 },
    },
    select: {
      itemId: true,
      quantity: true,
      unitCostCents: true,
      item: { select: { name: true } },
      purchaseOrder: { select: { tenantId: true, createdAt: true } },
    },
    take: 50_000,
  });

  interface Bucket {
    name: string;
    prices: number[];
    tenants: Set<string>;
    mine: Array<{ itemId: string; name: string; unitCostCents: number; quantity: number; at: Date }>;
  }
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    const key = productKey(line.item.name);
    if (key.length < MIN_KEY_LENGTH) continue;

    const bucket = buckets.get(key) ?? { name: line.item.name, prices: [], tenants: new Set(), mine: [] };
    const isMine = line.purchaseOrder.tenantId === tenantId;

    // A business's own prices never count towards the cohort it is being
    // compared against — otherwise a heavy buyer is largely measured
    // against itself and always looks average.
    if (!isMine) {
      bucket.prices.push(line.unitCostCents);
      bucket.tenants.add(line.purchaseOrder.tenantId);
    } else {
      bucket.mine.push({
        itemId: line.itemId,
        name: line.item.name,
        unitCostCents: line.unitCostCents,
        quantity: line.quantity,
        at: line.purchaseOrder.createdAt,
      });
    }

    buckets.set(key, bucket);
  }

  const rows: PriceComparison[] = [];
  const notEnoughData: string[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.mine.length === 0) continue;

    if (bucket.tenants.size < PRICE_COHORT_FLOOR) {
      notEnoughData.push(bucket.mine[0].name);
      continue;
    }

    const sorted = [...bucket.prices].sort((a, b) => a - b);
    const median = Math.round(quantile(sorted, 0.5));

    // Most recent purchase is what "yours" means: an old price is history.
    const latest = bucket.mine.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const difference = latest.unitCostCents - median;

    // Annualised at the rate this business actually buys, so the number is
    // theirs rather than a market-wide abstraction.
    const unitsInWindow = bucket.mine.reduce((sum, m) => sum + m.quantity, 0);
    const days = opts.sinceDays ?? 180;
    const unitsPerYear = (unitsInWindow / days) * 365;

    rows.push({
      itemId: latest.itemId,
      name: latest.name,
      yoursCents: latest.unitCostCents,
      medianCents: median,
      lowerQuartileCents: Math.round(quantile(sorted, 0.25)),
      upperQuartileCents: Math.round(quantile(sorted, 0.75)),
      cohort: bucket.tenants.size,
      purchases: sorted.length,
      differenceCents: difference,
      differencePercent: median === 0 ? 0 : Math.round((difference / median) * 1000) / 10,
      couldSaveCentsPerYear: difference > 0 ? Math.round(difference * unitsPerYear) : 0,
    });
  }

  rows.sort((a, b) => b.couldSaveCentsPerYear - a.couldSaveCentsPerYear);
  const total = rows.reduce((sum, r) => sum + r.couldSaveCentsPerYear, 0);
  const overpaying = rows.filter((r) => r.differenceCents > 0).length;

  return {
    optedIn: true,
    rows,
    notEnoughData: notEnoughData.slice(0, 40),
    totalCouldSaveCentsPerYear: total,
    summary:
      rows.length === 0
        ? `Nothing to compare yet. A line needs at least ${PRICE_COHORT_FLOOR} other businesses buying the same thing before anything is shown.`
        : overpaying === 0
          ? `Comparing ${rows.length} lines: you are at or below the middle on all of them.`
          : `${overpaying} of ${rows.length} lines are above what comparable businesses pay.`,
  };
}

export interface SupplierSpread {
  itemName: string;
  suppliers: Array<{ supplierName: string; lastPaidCents: number; purchases: number }>;
  bestCents: number;
  worstCents: number;
  spreadPercent: number;
}

/**
 * The same thing, from different suppliers, inside one business.
 *
 * Needs no cohort and no opt-in, because every number in it already belongs
 * to the business asking. It is often the more actionable of the two: a
 * builder buying the same cement from three merchants at three prices has a
 * saving available this afternoon, without anybody else being involved.
 */
export async function supplierSpread(
  tenantId: string,
  opts: { sinceDays?: number; now?: Date } = {}
): Promise<SupplierSpread[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 365) * 86_400_000);

  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: { tenantId, createdAt: { gte: since } },
      unitCostCents: { gt: 0 },
    },
    select: {
      unitCostCents: true,
      item: { select: { name: true } },
      purchaseOrder: {
        select: { createdAt: true, supplier: { select: { name: true } } },
      },
    },
    take: 20_000,
  });

  const byItem = new Map<
    string,
    { name: string; bySupplier: Map<string, { lastPaid: number; at: Date; count: number }> }
  >();

  for (const line of lines) {
    const supplierName = line.purchaseOrder.supplier?.name;
    if (!supplierName) continue;

    const key = productKey(line.item.name);
    if (key.length < MIN_KEY_LENGTH) continue;

    const item = byItem.get(key) ?? { name: line.item.name, bySupplier: new Map() };
    const existing = item.bySupplier.get(supplierName);
    if (!existing || line.purchaseOrder.createdAt > existing.at) {
      item.bySupplier.set(supplierName, {
        lastPaid: line.unitCostCents,
        at: line.purchaseOrder.createdAt,
        count: (existing?.count ?? 0) + 1,
      });
    } else {
      existing.count += 1;
    }
    byItem.set(key, item);
  }

  const out: SupplierSpread[] = [];

  for (const item of byItem.values()) {
    if (item.bySupplier.size < 2) continue;

    const suppliers = [...item.bySupplier.entries()]
      .map(([supplierName, v]) => ({
        supplierName,
        lastPaidCents: v.lastPaid,
        purchases: v.count,
      }))
      .sort((a, b) => a.lastPaidCents - b.lastPaidCents);

    const best = suppliers[0].lastPaidCents;
    const worst = suppliers[suppliers.length - 1].lastPaidCents;
    if (best === worst) continue;

    out.push({
      itemName: item.name,
      suppliers,
      bestCents: best,
      worstCents: worst,
      spreadPercent: Math.round(((worst - best) / best) * 1000) / 10,
    });
  }

  return out.sort((a, b) => b.spreadPercent - a.spreadPercent).slice(0, 100);
}
