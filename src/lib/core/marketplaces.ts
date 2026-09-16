// Selling somewhere else, and still having one set of books.
//
// A South African retailer is on Takealot, probably on Facebook Marketplace,
// maybe on Bob Shop, and has their own site on Shopify or WooCommerce. Each
// of those is a separate login, a separate settlement statement and a
// separate pile of fees — and none of them tells the business the thing it
// actually needs to know, which is whether a line makes money once the
// marketplace's commission is off it.
//
// Two halves, and only the second one needs anybody's permission:
//
//   The fee model is real and works today. Every marketplace publishes its
//   commission, and a business that knows the commission can be told the true
//   margin on a line before they list it. That is most of the value.
//
//   The order feed needs credentials. Takealot's Seller API needs a key
//   issued to the seller; Shopify needs a private app. Neither exists on this
//   deployment. What does work without either is the settlement CSV every one
//   of them lets a seller download, which is the shape this reads.

import { prisma } from "@/lib/db";

export type Marketplace = "takealot" | "shopify" | "woocommerce" | "bobshop" | "facebook" | "other";

export interface MarketplaceDef {
  key: Marketplace;
  label: string;
  /** Commission as a percentage of the selling price, by common category. */
  commission: Array<{ category: string; percent: number }>;
  /** Other money that comes off, in the words the statement uses. */
  otherFees: string[];
  /** How orders get here today. */
  feed: string;
  /** What a live connection would need, said plainly. */
  liveFeed: string;
}

export const MARKETPLACES: MarketplaceDef[] = [
  {
    key: "takealot",
    label: "Takealot",
    commission: [
      { category: "Electronics", percent: 9 },
      { category: "Home and kitchen", percent: 14 },
      { category: "Beauty and health", percent: 15 },
      { category: "Clothing", percent: 20 },
      { category: "Anything else", percent: 13 },
    ],
    otherFees: [
      "Success fee on the selling price, charged per unit sold.",
      "Fulfilment fee when Takealot stores and ships it.",
      "Storage, once stock has sat longer than the free period.",
      "A return costs the fulfilment fee again, and the item may come back unsellable.",
    ],
    feed: "The seller portal's sales report, downloaded as a CSV and read in here.",
    liveFeed: "A live feed needs a Takealot Seller API key issued to this seller. Not connected.",
  },
  {
    key: "shopify",
    label: "Shopify",
    commission: [{ category: "All", percent: 0 }],
    otherFees: ["The payment gateway's percentage, which is the real cost — the platform takes a monthly fee instead of commission."],
    feed: "The orders export from the admin, as a CSV.",
    liveFeed: "A live feed needs a private app on the store. Not connected.",
  },
  {
    key: "woocommerce",
    label: "WooCommerce",
    commission: [{ category: "All", percent: 0 }],
    otherFees: ["Only the payment gateway's percentage."],
    feed: "Already connected where a store's keys are set up.",
    liveFeed: "Built — see the store connection under settings.",
  },
  {
    key: "bobshop",
    label: "Bob Shop",
    commission: [{ category: "Anything else", percent: 10 }],
    otherFees: ["A listing fee on some categories, whether or not it sells."],
    feed: "The seller's sales CSV.",
    liveFeed: "No public API. The CSV is the connection.",
  },
  {
    key: "facebook",
    label: "Facebook Marketplace",
    commission: [{ category: "All", percent: 0 }],
    otherFees: ["Nothing taken, but nothing recorded either — every sale here has to be captured by hand or it is invisible."],
    feed: "Recorded as an ordinary cash sale.",
    liveFeed: "There is no seller feed for local listings. This is the one that has to be typed in.",
  },
];

export const MARKETPLACE_BY_KEY: Record<string, MarketplaceDef> = Object.fromEntries(MARKETPLACES.map((m) => [m.key, m]));

/**
 * What is actually left after the marketplace takes its share.
 *
 * The number that decides whether a line should be listed at all, and the one
 * sellers most often get wrong — because the commission comes off the selling
 * price including VAT, while the margin they have in their head is on the
 * price excluding it.
 */
export function trueMargin(params: {
  sellPriceCents: number;
  costCents: number;
  marketplace: Marketplace;
  category?: string;
  /** What it costs to get it to the customer, when the seller ships it. */
  shippingCents?: number;
  vatPercent?: number;
}): {
  commissionPercent: number;
  commissionCents: number;
  netCents: number;
  marginCents: number;
  marginPercent: number;
  verdict: string;
} {
  const def = MARKETPLACE_BY_KEY[params.marketplace];
  const rates = def?.commission ?? [{ category: "All", percent: 0 }];
  const rate = rates.find((r) => r.category === params.category)?.percent ?? rates[rates.length - 1].percent;

  const commission = Math.round((params.sellPriceCents * rate) / 100);
  const vat = params.vatPercent ? Math.round(params.sellPriceCents - params.sellPriceCents / (1 + params.vatPercent / 100)) : 0;
  const shipping = params.shippingCents ?? 0;

  const net = params.sellPriceCents - commission - vat - shipping;
  const margin = net - params.costCents;
  const marginPercent = params.sellPriceCents > 0 ? Math.round((margin / params.sellPriceCents) * 100) : 0;

  const verdict =
    margin <= 0
      ? `This loses money on every sale. At ${rate}% commission the price has to be at least ${money(Math.ceil((params.costCents + shipping + vat) / (1 - rate / 100)))} to break even.`
      : marginPercent < 10
        ? `${marginPercent}% left after everything. One return wipes out several sales at this margin.`
        : `${money(margin)} a unit, ${marginPercent}% of the selling price.`;

  return { commissionPercent: rate, commissionCents: commission, netCents: net, marginCents: margin, marginPercent, verdict };
}

function money(cents: number): string {
  return `R${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface ParsedOrder {
  reference: string;
  soldOn: Date;
  sku: string | null;
  description: string;
  quantity: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
}

/**
 * A settlement CSV, read into orders.
 *
 * Every marketplace names its columns differently and none of them is stable
 * between exports, so the match is by what a header means rather than what it
 * says — and a column it cannot place is reported rather than guessed at.
 */
export function parseSettlement(csv: string): { orders: ParsedOrder[]; unmatchedColumns: string[]; problems: string[] } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { orders: [], unmatchedColumns: [], problems: ["That file has no rows in it."] };

  const headers = splitRow(lines[0]).map((h) => h.trim());
  const lower = headers.map((h) => h.toLowerCase());

  const find = (...needles: string[]) => {
    for (const needle of needles) {
      const index = lower.findIndex((header) => header.includes(needle));
      if (index >= 0) return index;
    }
    return -1;
  };

  const at = {
    reference: find("order id", "order number", "order_id", "reference", "name"),
    date: find("date", "created"),
    sku: find("sku", "tsin", "product code"),
    description: find("product title", "title", "description", "item name", "lineitem name"),
    quantity: find("quantity", "qty", "units"),
    gross: find("selling price", "total", "gross", "amount", "lineitem price"),
    commission: find("commission", "success fee", "fee"),
  };

  const used = new Set(Object.values(at).filter((index) => index >= 0));
  const unmatchedColumns = headers.filter((_, index) => !used.has(index));
  const problems: string[] = [];

  if (at.reference < 0) problems.push("No order number column found, so these rows cannot be told apart from each other.");
  if (at.gross < 0) problems.push("No amount column found, so there is nothing to record.");
  if (problems.length > 0) return { orders: [], unmatchedColumns, problems };

  const orders: ParsedOrder[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitRow(lines[i]);
    if (row.length < 2) continue;

    const gross = moneyToCents(row[at.gross]);
    if (gross === null) {
      problems.push(`Row ${i + 1}: "${row[at.gross] ?? ""}" is not an amount, so it was left out.`);
      continue;
    }

    const commission = at.commission >= 0 ? (moneyToCents(row[at.commission]) ?? 0) : 0;
    const soldOn = at.date >= 0 ? new Date(row[at.date]) : new Date();

    orders.push({
      reference: row[at.reference]?.trim() || `row-${i}`,
      soldOn: Number.isNaN(soldOn.getTime()) ? new Date() : soldOn,
      sku: at.sku >= 0 ? row[at.sku]?.trim() || null : null,
      description: at.description >= 0 ? row[at.description]?.trim() || "Item" : "Item",
      quantity: at.quantity >= 0 ? Math.max(1, Number(row[at.quantity]) || 1) : 1,
      grossCents: gross,
      commissionCents: Math.abs(commission),
      netCents: gross - Math.abs(commission),
    });
  }

  return { orders, unmatchedColumns, problems };
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

function moneyToCents(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // A comma is a decimal point here and a thousands separator elsewhere; the
  // last separator in the string is the decimal one either way.
  const normalised = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Where the money is really coming from.
 *
 * Grouped by channel with the fees separated out, because a seller who
 * discovers Takealot is two-thirds of their revenue and a quarter of their
 * profit has learnt something they could not see anywhere else.
 */
export async function channelMix(tenantId: string, since: Date) {
  const invoices = await prisma.transaction.findMany({
    where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
    select: { amountCents: true, subject: true, poNumber: true, externalRef: true },
    take: 2000,
  });

  const byChannel = new Map<string, { revenueCents: number; count: number }>();
  for (const invoice of invoices) {
    const haystack = `${invoice.subject ?? ""} ${invoice.poNumber ?? ""} ${invoice.externalRef ?? ""}`.toLowerCase();
    const match = MARKETPLACES.find((place) => haystack.includes(place.key) || haystack.includes(place.label.toLowerCase()));
    const key = match?.label ?? "Direct";
    const row = byChannel.get(key) ?? { revenueCents: 0, count: 0 };
    row.revenueCents += invoice.amountCents;
    row.count += 1;
    byChannel.set(key, row);
  }

  const total = [...byChannel.values()].reduce((sum, row) => sum + row.revenueCents, 0);

  return {
    channels: [...byChannel.entries()]
      .map(([label, row]) => ({ label, ...row, share: total > 0 ? Math.round((row.revenueCents / total) * 100) : 0 }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    totalCents: total,
    caveat:
      "Worked out from what each invoice says about where it came from. A marketplace sale captured without naming the channel counts as direct.",
  };
}
