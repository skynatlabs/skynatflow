// Things that look wrong.
//
// A small business is not usually defrauded by a stranger. It loses money to
// a supplier who quietly raised a price, a refund nobody can account for, a
// card that keeps buying fuel on a Sunday, and the same invoice paid twice
// because it arrived by email and by post. None of these is dramatic and all
// of them are invisible unless something is counting.
//
// The rule that makes this usable rather than infuriating: everything here is
// a question, never an accusation. "This looks like the same spend twice" is
// something an owner checks in ten seconds. "Possible fraud detected" makes
// them distrust a bookkeeper who did nothing wrong, and they will switch the
// whole feature off rather than read the next one.
//
// And every finding carries the innocent explanation alongside it, because
// most of them are the innocent explanation.

import { prisma } from "@/lib/db";

export type Severity = "look" | "check" | "urgent";

export interface Finding {
  key: string;
  severity: Severity;
  /** What was noticed, in plain words. */
  what: string;
  /** The most likely innocent reason. Stated every time. */
  couldBe: string;
  /** What to do about it in ten seconds. */
  next: string;
  amountCents: number | null;
  at: Date | null;
  link: string | null;
}

/**
 * The same money going out twice.
 *
 * Already caught at capture by fingerprinting; this is the second pass, over
 * a longer window and a looser match, for the pair that arrived a fortnight
 * apart by two different routes.
 */
async function doubledCosts(tenantId: string, since: Date): Promise<Finding[]> {
  const costs = await prisma.expense.findMany({
    where: { tenantId, spentOn: { gte: since }, status: { notIn: ["REJECTED", "DUPLICATE"] } },
    select: { id: true, amountCents: true, spentOn: true, reference: true, supplierName: true, supplier: { select: { name: true, companyName: true } } },
    take: 1000,
  });

  const byKey = new Map<string, typeof costs>();
  for (const cost of costs) {
    // Same supplier and same amount. Not the same day — the whole point is
    // the pair that arrived a fortnight apart.
    const who = (cost.supplier?.companyName ?? cost.supplier?.name ?? cost.supplierName ?? "").toLowerCase().trim();
    if (!who) continue;
    const key = `${who}|${cost.amountCents}`;
    byKey.set(key, [...(byKey.get(key) ?? []), cost]);
  }

  const findings: Finding[] = [];
  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.spentOn.getTime() - b.spentOn.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const daysApart = Math.round((last.spentOn.getTime() - first.spentOn.getTime()) / 86_400_000);

    // A monthly bill is the same supplier and the same amount every month,
    // and flagging it would make this list useless within a week.
    if (daysApart >= 25 && daysApart <= 35 && group.length <= 3) continue;
    // References that differ are two real invoices.
    if (first.reference && last.reference && first.reference !== last.reference) continue;

    findings.push({
      key: `doubled:${first.id}`,
      severity: group.length > 2 ? "urgent" : "check",
      what: `${group.length} costs of the same amount to ${first.supplier?.companyName ?? first.supplier?.name ?? first.supplierName}, ${daysApart} days apart.`,
      couldBe: "A bill that genuinely recurs, or a supplier who invoices the same amount each time.",
      next: "Open the two and compare the invoice numbers. If they match, one of them is the same money twice.",
      amountCents: first.amountCents,
      at: last.spentOn,
      link: null,
    });
  }

  return findings;
}

/** Money going back out to customers, which is the easiest thing to hide. */
async function oddRefunds(tenantId: string, since: Date): Promise<Finding[]> {
  const refunds = await prisma.transaction.findMany({
    where: { tenantId, type: "REFUND", createdAt: { gte: since } },
    select: { id: true, amountCents: true, createdAt: true, parentId: true, party: { select: { name: true, companyName: true } } },
    take: 200,
  });

  const findings: Finding[] = [];
  for (const refund of refunds) {
    // A refund with nothing behind it is the shape money takes when it leaves
    // a business quietly.
    if (!refund.parentId) {
      findings.push({
        key: `refund-orphan:${refund.id}`,
        severity: "urgent",
        what: `A refund to ${refund.party.companyName ?? refund.party.name} with no invoice behind it.`,
        couldBe: "A goodwill payment somebody recorded as a refund because there was nowhere else to put it.",
        next: "Find out which invoice it belongs to, or record it as a cost so it appears in the books as what it is.",
        amountCents: refund.amountCents,
        at: refund.createdAt,
        link: null,
      });
      continue;
    }

    const invoice = await prisma.transaction.findUnique({ where: { id: refund.parentId }, select: { amountCents: true } });
    if (invoice && refund.amountCents > invoice.amountCents) {
      findings.push({
        key: `refund-over:${refund.id}`,
        severity: "urgent",
        what: `A refund larger than the invoice it is against, to ${refund.party.companyName ?? refund.party.name}.`,
        couldBe: "Two invoices refunded together and recorded against one.",
        next: "Split it, or correct the amount. As it stands the customer's balance is wrong.",
        amountCents: refund.amountCents,
        at: refund.createdAt,
        link: null,
      });
    }
  }

  return findings;
}

/**
 * A supplier price that moved and nobody noticed.
 *
 * The slowest and most expensive leak there is: a 6% rise on something bought
 * weekly costs more over a year than most of the things a business does worry
 * about.
 */
async function priceDrift(tenantId: string, since: Date): Promise<Finding[]> {
  const lines = await prisma.expenseLine.findMany({
    where: { expense: { tenantId, spentOn: { gte: since }, status: { notIn: ["REJECTED", "DUPLICATE"] } }, unitCents: { gt: 0 } },
    select: { description: true, unitCents: true, expense: { select: { spentOn: true, supplier: { select: { name: true, companyName: true } } } } },
    orderBy: { expense: { spentOn: "asc" } },
    take: 2000,
  });

  const byItem = new Map<string, Array<{ price: number; at: Date; who: string }>>();
  for (const line of lines) {
    const key = line.description.toLowerCase().trim();
    if (!key) continue;
    byItem.set(key, [
      ...(byItem.get(key) ?? []),
      { price: line.unitCents, at: line.expense.spentOn, who: line.expense.supplier?.companyName ?? line.expense.supplier?.name ?? "a supplier" },
    ]);
  }

  const findings: Finding[] = [];
  for (const [item, history] of byItem) {
    // Four buys is the least that can distinguish a rise from a one-off.
    if (history.length < 4) continue;

    const half = Math.floor(history.length / 2);
    const early = history.slice(0, half);
    const late = history.slice(half);
    const averageOf = (rows: typeof history) => rows.reduce((sum, row) => sum + row.price, 0) / rows.length;

    const was = averageOf(early);
    const now = averageOf(late);
    if (was <= 0) continue;

    const change = Math.round(((now - was) / was) * 100);
    if (change < 8) continue;

    findings.push({
      key: `drift:${item}`,
      severity: change >= 20 ? "check" : "look",
      what: `${item} is costing ${change}% more than it was, from ${late[late.length - 1].who}.`,
      couldBe: "A real market movement, or a different size or grade recorded under the same description.",
      next: "Worth a call, and worth checking whether the price it is sold at moved with it.",
      amountCents: Math.round(now - was),
      at: late[late.length - 1].at,
      link: null,
    });
  }

  return findings;
}

/** Spending at hours or on days that are worth a second look. */
async function oddTiming(tenantId: string, since: Date): Promise<Finding[]> {
  const costs = await prisma.expense.findMany({
    where: { tenantId, spentOn: { gte: since }, status: { notIn: ["REJECTED", "DUPLICATE"] } },
    select: { id: true, amountCents: true, spentOn: true, descriptionText: true, incurredById: true },
    take: 1000,
  });

  const weekend = costs.filter((cost) => [0, 6].includes(cost.spentOn.getDay()));
  if (weekend.length === 0) return [];

  const weekendShare = Math.round((weekend.length / costs.length) * 100);
  // Plenty of businesses trade at the weekend. Only an unusual share is worth
  // a sentence, and even then it is a question.
  if (weekendShare < 25) return [];

  return [
    {
      key: "timing:weekend",
      severity: "look",
      what: `${weekendShare}% of this period's spending happened at weekends.`,
      couldBe: "A business that trades on Saturdays, or slips captured later and dated to when somebody got round to it.",
      next: "Worth a glance at who is spending, if the business does not normally work weekends.",
      amountCents: weekend.reduce((sum, cost) => sum + cost.amountCents, 0),
      at: null,
      link: null,
    },
  ];
}

const ORDER: Record<Severity, number> = { urgent: 0, check: 1, look: 2 };

/**
 * Everything worth a second look, in one list.
 *
 * Capped, because a watchlist of forty things is a watchlist nobody reads,
 * and the ones that matter are always at the top anyway.
 */
export async function watchlist(params: { tenantId: string; sinceDays?: number }): Promise<{
  findings: Finding[];
  note: string;
  stance: string;
}> {
  const since = new Date(Date.now() - (params.sinceDays ?? 180) * 86_400_000);

  const [doubled, refunds, drift, timing] = await Promise.all([
    doubledCosts(params.tenantId, since),
    oddRefunds(params.tenantId, since),
    priceDrift(params.tenantId, since),
    oddTiming(params.tenantId, since),
  ]);

  const findings = [...doubled, ...refunds, ...drift, ...timing]
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.amountCents ?? 0) - (a.amountCents ?? 0))
    .slice(0, 12);

  return {
    findings,
    note:
      findings.length === 0
        ? "Nothing on the watchlist. That is the usual answer and it is a good one."
        : `${findings.length} ${findings.length === 1 ? "thing" : "things"} worth a second look.`,
    stance:
      "Everything here is a question, not an accusation. Most of them turn out to be the innocent explanation, which is why it is printed beside each one.",
  };
}
