// What is about to happen.
//
// Every prediction here is arithmetic over this business's own history, and
// every one of them says how sure it is and on how much. That is not
// modesty — a forecast built on four data points, presented with the same
// confidence as one built on four hundred, is how a business orders stock it
// cannot sell and then stops believing the whole product.
//
// Nothing here calls a model. A small business's patterns are seasonal and
// shallow, and a moving average that a person can check beats something they
// have to take on faith. Where there is genuinely not enough history, the
// answer is "not enough to say" rather than a number.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

const DAY = 86_400_000;

export type Confidence = "good" | "rough" | "not-enough";

function confidenceFrom(points: number): Confidence {
  if (points >= 12) return "good";
  if (points >= 5) return "rough";
  return "not-enough";
}

// ------------------------------------------------------------ what will sell

export interface DemandForecast {
  itemId: string;
  name: string;
  sku: string | null;
  /** Units a month, averaged over the months there is history for. */
  perMonth: number;
  /** The same figure for the matching month last year, where there is one. */
  sameMonthLastYear: number | null;
  /** Units expected over the next thirty days. */
  nextThirtyDays: number;
  onHand: number | null;
  /** Days of cover at the rate it is selling. Null when it is not selling. */
  daysOfCover: number | null;
  /** Units to order to hold sixty days of cover. */
  orderNow: number;
  confidence: Confidence;
  monthsOfHistory: number;
}

/**
 * What to stock before the season rather than after it.
 *
 * The rate is a twelve-month average, adjusted by what the same month did
 * last year where there is a year of history — which is the whole of
 * seasonality for a business this size, and an honest improvement on a flat
 * average for anybody selling heaters or school uniforms.
 */
export async function demandForecast(tenantId: string, now = new Date()): Promise<DemandForecast[]> {
  const since = new Date(now.getTime() - 400 * DAY);
  const [lines, items] = await Promise.all([
    prisma.transactionLine.findMany({
      where: {
        item: { tenantId },
        transaction: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
      },
      select: { itemId: true, quantity: true, transaction: { select: { createdAt: true } } },
    }),
    prisma.item.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, sku: true, stockQty: true } }),
  ]);

  const byItem = new Map<string, { total: number; months: Set<string>; lastYearSameMonth: number }>();
  const thisMonth = now.getUTCMonth();
  const oneYearAgo = new Date(now.getTime() - 365 * DAY);

  for (const line of lines) {
    const at = line.transaction.createdAt;
    const row = byItem.get(line.itemId) ?? { total: 0, months: new Set<string>(), lastYearSameMonth: 0 };
    row.total += line.quantity;
    row.months.add(`${at.getUTCFullYear()}-${at.getUTCMonth()}`);
    // The same month, a year back, within a fortnight either side.
    if (at.getUTCMonth() === thisMonth && at < new Date(oneYearAgo.getTime() + 20 * DAY)) {
      row.lastYearSameMonth += line.quantity;
    }
    byItem.set(line.itemId, row);
  }

  const out: DemandForecast[] = [];
  for (const item of items) {
    const row = byItem.get(item.id);
    if (!row || row.total === 0) continue;

    const months = Math.max(1, row.months.size);
    const perMonth = row.total / months;
    const lastYear = row.lastYearSameMonth > 0 ? row.lastYearSameMonth : null;

    // Where last year's matching month is known, lean half-way towards it.
    // A full swing to one year's figure over-fits; ignoring it entirely is
    // how a business runs out of heaters in May.
    const rate = lastYear === null ? perMonth : (perMonth + lastYear) / 2;
    const next30 = Math.round(rate);
    const onHand = item.stockQty;
    const cover = onHand !== null && rate > 0 ? Math.round((onHand / rate) * 30) : null;

    out.push({
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      perMonth: Math.round(perMonth * 10) / 10,
      sameMonthLastYear: lastYear,
      nextThirtyDays: next30,
      onHand,
      daysOfCover: cover,
      orderNow: onHand === null ? 0 : Math.max(0, Math.ceil(rate * 2 - onHand)),
      confidence: confidenceFrom(months),
      monthsOfHistory: months,
    });
  }

  return out.sort((a, b) => (a.daysOfCover ?? 9999) - (b.daysOfCover ?? 9999));
}

// -------------------------------------------------------- what is priced wrong

export interface PriceSignal {
  itemId: string;
  name: string;
  soldUnits: number;
  revenueCents: number;
  marginPercent: number | null;
  /** How often it is discounted, which is the price telling you something. */
  discountedShare: number;
  averageDiscountPercent: number;
  suggestion: string;
  confidence: Confidence;
}

/**
 * Where money is being left on the table, per line item.
 *
 * Two signals, both from what has actually been sold. A line that never gets
 * discounted and sells well is under-priced. A line that is discounted on
 * most documents is priced at a number nobody believes, and the list price is
 * fiction — which matters because every margin figure is built on it.
 */
export async function priceSignals(tenantId: string, opts: { sinceDays?: number; now?: Date } = {}): Promise<PriceSignal[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 365) * DAY);

  const lines = await prisma.transactionLine.findMany({
    where: {
      item: { tenantId },
      transaction: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
    },
    select: {
      itemId: true,
      quantity: true,
      unitPriceCents: true,
      discountPercent: true,
      item: { select: { name: true, costCents: true, unitPriceCents: true } },
    },
  });

  const by = new Map<string, { name: string; units: number; revenue: number; cost: number; docs: number; discounted: number; discountSum: number }>();
  for (const line of lines) {
    const row = by.get(line.itemId) ?? { name: line.item.name, units: 0, revenue: 0, cost: 0, docs: 0, discounted: 0, discountSum: 0 };
    const discount = line.discountPercent ?? 0;
    row.units += line.quantity;
    row.revenue += Math.round(line.quantity * line.unitPriceCents * (1 - discount / 100));
    row.cost += line.quantity * (line.item.costCents ?? 0);
    row.docs += 1;
    if (discount > 0) {
      row.discounted += 1;
      row.discountSum += discount;
    }
    by.set(line.itemId, row);
  }

  const out: PriceSignal[] = [];
  for (const [itemId, row] of by) {
    if (row.docs < 3) continue;
    const marginPercent = row.revenue > 0 && row.cost > 0 ? Math.round(((row.revenue - row.cost) / row.revenue) * 100) : null;
    const discountedShare = Math.round((row.discounted / row.docs) * 100);
    const averageDiscount = row.discounted === 0 ? 0 : Math.round(row.discountSum / row.discounted);

    let suggestion: string;
    if (discountedShare >= 60) {
      suggestion = `Discounted on ${discountedShare}% of documents, averaging ${averageDiscount}% off. The list price is fiction — and every margin figure is built on it. Set it to what it actually sells for.`;
    } else if (discountedShare === 0 && row.docs >= 8) {
      suggestion = `Sold ${row.docs} times and never discounted. Nobody has pushed back on this price — it is the safest one to raise.`;
    } else if (marginPercent !== null && marginPercent < 15) {
      suggestion = `Margin of ${marginPercent}% across ${row.docs} sales. At this level a single return wipes out several sales.`;
    } else {
      continue;
    }

    out.push({
      itemId,
      name: row.name,
      soldUnits: row.units,
      revenueCents: row.revenue,
      marginPercent,
      discountedShare,
      averageDiscountPercent: averageDiscount,
      suggestion,
      confidence: confidenceFrom(row.docs),
    });
  }

  return out.sort((a, b) => b.revenueCents - a.revenueCents);
}

// ---------------------------------------------------------- who is drifting off

export interface ChurnRisk {
  partyId: string;
  customer: string;
  /** What they were worth a month, while they were still buying. */
  monthlyValueCents: number;
  /** Their own usual gap between orders, in days. */
  usualGapDays: number;
  daysSinceLast: number;
  /** How far past their own pattern they are. 2 means twice their usual gap. */
  overdueRatio: number;
  lastBought: Date;
  phone: string | null;
  note: string;
}

/**
 * Which good customer has gone quiet, before they are gone.
 *
 * Measured against each customer's own rhythm rather than a fixed window: a
 * builder who orders every six weeks and a restaurant that orders weekly are
 * both overdue at very different points, and a single "90 days quiet" rule
 * flags the wrong one every time.
 */
export async function churnRisk(tenantId: string, now = new Date()): Promise<ChurnRisk[]> {
  const since = new Date(now.getTime() - 800 * DAY);
  const [invoices, tenant] = await Promise.all([
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
      select: { partyId: true, amountCents: true, createdAt: true, party: { select: { name: true, companyName: true, phone: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
  ]);

  const by = new Map<string, { name: string; phone: string | null; dates: Date[]; total: number }>();
  for (const invoice of invoices) {
    const row = by.get(invoice.partyId) ?? {
      name: invoice.party.companyName ?? invoice.party.name,
      phone: invoice.party.phone,
      dates: [],
      total: 0,
    };
    row.dates.push(invoice.createdAt);
    row.total += invoice.amountCents;
    by.set(invoice.partyId, row);
  }

  const out: ChurnRisk[] = [];
  for (const [partyId, row] of by) {
    // Three orders is the minimum for a rhythm. Two is a coincidence.
    if (row.dates.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < row.dates.length; i++) {
      gaps.push((row.dates[i].getTime() - row.dates[i - 1].getTime()) / DAY);
    }
    gaps.sort((a, b) => a - b);
    const usual = Math.max(7, Math.round(gaps[Math.floor(gaps.length / 2)]));

    const last = row.dates[row.dates.length - 1];
    const quiet = Math.floor((now.getTime() - last.getTime()) / DAY);
    const ratio = Math.round((quiet / usual) * 10) / 10;
    if (ratio < 1.8) continue;

    const spanDays = Math.max(30, (last.getTime() - row.dates[0].getTime()) / DAY);
    const monthly = Math.round(row.total / (spanDays / 30));

    out.push({
      partyId,
      customer: row.name,
      monthlyValueCents: monthly,
      usualGapDays: usual,
      daysSinceLast: quiet,
      overdueRatio: ratio,
      lastBought: last,
      phone: row.phone,
      note:
        `Usually orders every ${usual} days and has not for ${quiet}. ` +
        `They were worth about ${formatMoney(monthly, tenant.currency)} a month.`,
    });
  }

  return out.sort((a, b) => b.monthlyValueCents * b.overdueRatio - a.monthlyValueCents * a.overdueRatio);
}

// ------------------------------------------------------------ which quote first

export interface LeadScore {
  transactionId: string;
  number: string | null;
  customer: string;
  partyId: string;
  amountCents: number;
  daysOut: number;
  score: number;
  /** Why it scored what it did, in the order the reasons weighed. */
  reasons: string[];
}

/**
 * Which quote to chase first, from what actually closed before.
 *
 * Every factor is something this business's own history supports: whether
 * this customer has bought before and how often, whether the quote has been
 * opened, how it compares in size to what they usually spend, and how long it
 * has been sitting. The score has no units and is not pretending to be a
 * probability — it is an ordering, and the reasons are what a person reads.
 */
export async function scoreOpenQuotes(tenantId: string, now = new Date()): Promise<LeadScore[]> {
  const quotes = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE", status: "SENT" },
    select: {
      id: true,
      externalRef: true,
      amountCents: true,
      createdAt: true,
      openCount: true,
      lastOpenedAt: true,
      partyId: true,
      party: { select: { name: true, companyName: true } },
    },
    take: 200,
  });
  if (quotes.length === 0) return [];

  const partyIds = [...new Set(quotes.map((q) => q.partyId))];
  const history = await prisma.transaction.groupBy({
    by: ["partyId"],
    where: { tenantId, partyId: { in: partyIds }, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] } },
    _count: { _all: true },
    _avg: { amountCents: true },
  });
  const boughtBefore = new Map(history.map((h) => [h.partyId, { orders: h._count._all, average: h._avg.amountCents ?? 0 }]));

  return quotes
    .map((quote) => {
      const reasons: string[] = [];
      let score = 50;

      const past = boughtBefore.get(quote.partyId);
      if (past && past.orders >= 3) {
        score += 25;
        reasons.push(`Has bought ${past.orders} times before`);
      } else if (past) {
        score += 10;
        reasons.push("Has bought before");
      } else {
        score -= 5;
        reasons.push("Never bought from you");
      }

      if (quote.openCount >= 2) {
        score += 20;
        reasons.push(`Opened it ${quote.openCount} times`);
      } else if (quote.openCount === 1) {
        score += 8;
        reasons.push("Opened it once");
      } else {
        score -= 10;
        reasons.push("Never opened it");
      }

      // A quote far above what this customer usually spends is a different
      // kind of decision and takes longer, whoever they are.
      if (past && past.average > 0 && quote.amountCents > past.average * 3) {
        score -= 10;
        reasons.push("Much bigger than they usually spend");
      }

      const daysOut = Math.floor((now.getTime() - quote.createdAt.getTime()) / DAY);
      if (daysOut > 30) {
        score -= 15;
        reasons.push(`${daysOut} days old`);
      } else if (daysOut >= 3 && daysOut <= 14) {
        score += 10;
        reasons.push("In the window where chasing works");
      }

      return {
        transactionId: quote.id,
        number: quote.externalRef,
        customer: quote.party.companyName ?? quote.party.name,
        partyId: quote.partyId,
        amountCents: quote.amountCents,
        daysOut,
        score: Math.max(0, Math.min(100, score)),
        reasons,
      };
    })
    .sort((a, b) => b.score * b.amountCents - a.score * a.amountCents);
}

// ----------------------------------------------------------- what to do first

export interface NextAction {
  what: string;
  why: string;
  /** Where to go and do it, relative to the dashboard root. */
  href: string;
  /** What it is worth, where that can be said. */
  worthCents: number | null;
}

/**
 * One ranked list each morning.
 *
 * The whole product in a function: everything that could be done today, from
 * every part of the business, ordered by what it is worth. Deliberately capped
 * — a list of forty things is a list nobody starts.
 */
export async function nextBestActions(tenantId: string, now = new Date()): Promise<NextAction[]> {
  const [quotes, quiet, tenant] = await Promise.all([
    scoreOpenQuotes(tenantId, now),
    churnRisk(tenantId, now),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  const money = (c: number) => formatMoney(c, tenant.currency);

  const actions: NextAction[] = [];

  for (const quote of quotes.slice(0, 3)) {
    actions.push({
      what: `Chase ${quote.customer} on ${quote.number ?? "their quote"}`,
      why: quote.reasons.slice(0, 2).join("; "),
      href: `/quotes/${quote.transactionId}`,
      worthCents: quote.amountCents,
    });
  }

  for (const customer of quiet.slice(0, 2)) {
    actions.push({
      what: `Ring ${customer.customer}`,
      why: customer.note,
      href: `/customers/${customer.partyId}`,
      worthCents: customer.monthlyValueCents,
    });
  }

  const stock = (await demandForecast(tenantId, now)).filter((d) => d.daysOfCover !== null && d.daysOfCover < 14);
  if (stock.length > 0) {
    actions.push({
      what: `Order ${stock.length === 1 ? stock[0].name : `${stock.length} lines that are about to run out`}`,
      why:
        stock.length === 1
          ? `${stock[0].daysOfCover} days of cover left at the rate it is selling.`
          : `The shortest has ${stock[0].daysOfCover} days of cover left.`,
      href: "/inventory",
      worthCents: null,
    });
  }

  const priced = (await priceSignals(tenantId, { now })).slice(0, 1);
  for (const line of priced) {
    actions.push({ what: `Look at the price of ${line.name}`, why: line.suggestion, href: "/products", worthCents: line.revenueCents });
  }

  return actions
    .sort((a, b) => (b.worthCents ?? 0) - (a.worthCents ?? 0))
    .slice(0, 6)
    .map((a) => ({ ...a, why: a.worthCents ? `${a.why} Worth about ${money(a.worthCents)}.` : a.why }));
}
