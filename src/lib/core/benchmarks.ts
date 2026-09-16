// How this business compares.
//
// The most valuable thing a platform with many small businesses on it knows,
// and the easiest to get badly wrong. Three rules, and the first two are not
// negotiable:
//
//   OPT IN. A business is compared only once it has said yes, and it sees
//   nothing until it does. Comparing somebody who did not ask, even
//   anonymously, is using their data for somebody else's benefit.
//
//   NEVER IDENTIFIABLE. A cohort of two is one competitor reading the other's
//   margin. Nothing is reported below a floor of five contributing
//   businesses, and the floor is stated rather than silently applied — a
//   comparison that quietly disappears looks like a bug.
//
//   DISTRIBUTIONS, NOT AVERAGES. A mean is dragged about by one outlier and
//   tells a business almost nothing. The median and the quartiles say where
//   somebody actually sits, and "you are in the bottom quarter" is a sentence
//   somebody can act on.

import { prisma } from "@/lib/db";

/** Below this, a cohort is a handful of businesses that could be named. */
const FLOOR = 5;

export type Metric = "margin" | "overdue-days" | "quote-win-rate" | "average-invoice";

export const METRIC_LABEL: Record<Metric, string> = {
  margin: "Gross margin",
  "overdue-days": "How long invoices take to be paid",
  "quote-win-rate": "Quotes that turn into work",
  "average-invoice": "Average invoice",
};

export interface Comparison {
  metric: Metric;
  label: string;
  /** This business's own figure. */
  yours: number | null;
  /** The middle of the cohort. */
  median: number | null;
  lowerQuartile: number | null;
  upperQuartile: number | null;
  /** How many businesses are in the comparison. Never below the floor. */
  cohort: number;
  /** "top quarter" | "above the middle" | "below the middle" | "bottom quarter" */
  standing: string | null;
  unit: "percent" | "days" | "money";
  note: string;
}

export async function setBenchmarkOptIn(tenantId: string, optedIn: boolean) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { benchmarksOptedIn: optedIn } });
}

async function figuresFor(tenantId: string, metric: Metric, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - 365 * 86_400_000);

  if (metric === "margin") {
    const lines = await prisma.transactionLine.findMany({
      where: {
        item: { tenantId },
        transaction: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
      },
      select: { quantity: true, unitPriceCents: true, discountPercent: true, item: { select: { costCents: true } } },
    });
    let revenue = 0;
    let cost = 0;
    for (const line of lines) {
      revenue += Math.round(line.quantity * line.unitPriceCents * (1 - (line.discountPercent ?? 0) / 100));
      cost += line.quantity * (line.item.costCents ?? 0);
    }
    // Without costs on the items there is no margin to report, and a figure
    // of 100% would be a lie rather than a good result.
    if (revenue === 0 || cost === 0) return null;
    return Math.round(((revenue - cost) / revenue) * 100);
  }

  if (metric === "overdue-days") {
    const paid = await prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: "PAID", dueAt: { not: null }, createdAt: { gte: since } },
      select: { dueAt: true, children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      take: 500,
    });
    const gaps = paid
      .map((p) => {
        const on = p.children[0]?.createdAt;
        return on && p.dueAt ? Math.round((on.getTime() - p.dueAt.getTime()) / 86_400_000) : null;
      })
      .filter((d): d is number => d !== null);
    if (gaps.length < 3) return null;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  if (metric === "quote-win-rate") {
    const quotes = await prisma.transaction.groupBy({
      by: ["status"],
      where: { tenantId, type: "QUOTE", createdAt: { gte: since } },
      _count: { _all: true },
    });
    const accepted = quotes.find((q) => q.status === "ACCEPTED")?._count._all ?? 0;
    const declined = quotes.find((q) => q.status === "DECLINED")?._count._all ?? 0;
    if (accepted + declined < 3) return null;
    return Math.round((accepted / (accepted + declined)) * 100);
  }

  const invoices = await prisma.transaction.aggregate({
    where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
    _avg: { amountCents: true },
    _count: { _all: true },
  });
  if (invoices._count._all < 3) return null;
  return Math.round(invoices._avg.amountCents ?? 0);
}

function quartiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { lower: at(0.25), median: at(0.5), upper: at(0.75) };
}

/**
 * How this business sits against others in its trade.
 *
 * The cohort is businesses in the same trade that have opted in — not every
 * business on the platform, because a plumber's margin against a wholesaler's
 * is a comparison with no meaning.
 */
export async function compare(tenantId: string, now = new Date()): Promise<{ optedIn: boolean; comparisons: Comparison[]; note: string }> {
  const me = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { niche: true, currency: true, benchmarksOptedIn: true },
  });

  if (!me.benchmarksOptedIn) {
    return {
      optedIn: false,
      comparisons: [],
      note:
        "Comparisons are off. Turning them on adds this workspace's figures to the anonymous pool for its trade and shows you where you sit in it. Nothing identifying anybody is ever shown, and nothing below five businesses is reported at all.",
    };
  }

  const cohort = await prisma.tenant.findMany({
    where: { niche: me.niche, benchmarksOptedIn: true, currency: me.currency },
    select: { id: true },
    take: 500,
  });

  const metrics: Metric[] = ["margin", "overdue-days", "quote-win-rate", "average-invoice"];
  const comparisons: Comparison[] = [];

  for (const metric of metrics) {
    const unit: Comparison["unit"] = metric === "average-invoice" ? "money" : metric === "overdue-days" ? "days" : "percent";
    const values: number[] = [];
    let mine: number | null = null;

    for (const member of cohort) {
      const value = await figuresFor(member.id, metric, now);
      if (value === null) continue;
      values.push(value);
      if (member.id === tenantId) mine = value;
    }

    if (values.length < FLOOR) {
      comparisons.push({
        metric,
        label: METRIC_LABEL[metric],
        yours: mine,
        median: null,
        lowerQuartile: null,
        upperQuartile: null,
        cohort: values.length,
        standing: null,
        unit,
        // Said rather than hidden: a comparison that quietly vanishes looks
        // like a bug, and the reason is one a business will accept.
        note: `Only ${values.length} ${values.length === 1 ? "business has" : "businesses have"} enough recorded for this. Nothing is reported below ${FLOOR}, because a handful of businesses can be worked out from a number.`,
      });
      continue;
    }

    const { lower, median, upper } = quartiles(values);
    // Being paid sooner is better; everything else here is better higher.
    const higherIsBetter = metric !== "overdue-days";
    let standing: string | null = null;
    if (mine !== null) {
      const top = higherIsBetter ? mine >= upper : mine <= lower;
      const bottom = higherIsBetter ? mine <= lower : mine >= upper;
      const above = higherIsBetter ? mine > median : mine < median;
      standing = top ? "top quarter" : bottom ? "bottom quarter" : above ? "above the middle" : "below the middle";
    }

    comparisons.push({
      metric,
      label: METRIC_LABEL[metric],
      yours: mine,
      median,
      lowerQuartile: lower,
      upperQuartile: upper,
      cohort: values.length,
      standing,
      unit,
      note:
        mine === null
          ? "Not enough recorded in this workspace yet to place it."
          : `You are in the ${standing} of ${values.length} similar businesses.`,
    });
  }

  return {
    optedIn: true,
    comparisons,
    note: `Compared against ${cohort.length} ${cohort.length === 1 ? "business" : "businesses"} in the same trade that have also opted in. Nothing identifies anybody, and nothing below ${FLOOR} contributors is reported.`,
  };
}
