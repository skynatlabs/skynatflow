// The capture ledger.
//
// What percentage of the money that left is actually recorded, and where the
// gaps are. A cost figure built on two thirds of the costs is worse than no
// figure — it is confidently wrong — and this is the number that says which
// one a business has. Every "cost per kilometre" and every margin the officers
// quote should be read next to it.
//
// The only honest denominator is the bank. Money that left the account and
// matches nothing recorded is, by definition, the unrecorded part. A
// workspace with no bank feed cannot know its coverage, and this says so
// rather than reporting 100%.

import { ExpenseSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPENT } from "./expenses";
import { formatMoney, tenantCurrency } from "./currency";

export interface CaptureGap {
  kind: "VEHICLE_NO_FUEL" | "DRIVER_NO_SPEND" | "TRIP_NO_DISTANCE" | "UNTAGGED_SPEND" | "NO_BANK_FEED";
  label: string;
  detail: string;
  cents?: number;
  subjectType?: string;
  subjectId?: string;
}

export interface CaptureLedger {
  from: Date;
  to: Date;
  recordedCents: number;
  recordedCount: number;
  /** Money out of the bank that matches nothing recorded. */
  unexplainedCents: number;
  unexplainedCount: number;
  /** Null when there is no bank feed to measure against. */
  coveragePercent: number | null;
  hasBankFeed: boolean;
  bySource: Array<{ source: ExpenseSource; cents: number; count: number }>;
  gaps: CaptureGap[];
  summary: string;
}

export async function captureLedger(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<CaptureLedger> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 30 * 86_400_000);
  // Every read at once: none of them depends on another's answer.
  const [currency, expenses, bankAccounts, unexplained, movedAssets, fuelledAssets, assetNames, noDistance] = await Promise.all([
    tenantCurrency(tenantId),
    prisma.expense.findMany({
      where: { tenantId, status: SPENT, spentOn: { gte: from, lte: to }, isOwnerDrawing: { not: true } },
      select: { amountCents: true, source: true, assetId: true, tripId: true, jobCardId: true, transactionId: true },
    }),
    prisma.bankAccount.count({ where: { tenantId, isActive: true } }),
    prisma.bankTransaction.aggregate({
      where: { tenantId, status: "UNMATCHED", amountCents: { lt: 0 }, postedOn: { gte: from, lte: to } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.trip.groupBy({
      by: ["assetId"],
      where: { tenantId, status: "DONE", startedAt: { gte: from, lte: to }, assetId: { not: null } },
      _sum: { distanceKm: true },
      _count: true,
    }),
    prisma.expense.findMany({
      where: { tenantId, status: SPENT, spentOn: { gte: from, lte: to }, assetId: { not: null } },
      select: { assetId: true },
      distinct: ["assetId"],
    }),
    prisma.asset.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    // Trips that ended without a distance are kilometres that exist and are
    // divided by nothing.
    prisma.trip.count({ where: { tenantId, status: "DONE", startedAt: { gte: from, lte: to }, distanceKm: null } }),
  ]);
  const money = (c: number) => formatMoney(c, currency);

  const recordedCents = expenses.reduce((s, e) => s + e.amountCents, 0);
  const unexplainedCents = Math.abs(unexplained._sum.amountCents ?? 0);
  const hasBankFeed = bankAccounts > 0;
  const coveragePercent =
    hasBankFeed && recordedCents + unexplainedCents > 0
      ? Math.round((recordedCents / (recordedCents + unexplainedCents)) * 100)
      : hasBankFeed
        ? 100
        : null;

  const bySourceMap = new Map<ExpenseSource, { cents: number; count: number }>();
  for (const e of expenses) {
    const cur = bySourceMap.get(e.source) ?? { cents: 0, count: 0 };
    cur.cents += e.amountCents;
    cur.count += 1;
    bySourceMap.set(e.source, cur);
  }
  const bySource = [...bySourceMap.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.cents - a.cents);

  const gaps: CaptureGap[] = [];

  if (!hasBankFeed) {
    gaps.push({
      kind: "NO_BANK_FEED",
      label: "No bank statement to measure against",
      detail:
        "Without a statement there is no way to know what was spent and never recorded. Import one on the banking page and this becomes a percentage.",
    });
  }

  // Vehicles that moved and never fuelled — the classic sign of slips in a
  // glovebox rather than in the books.
  if (movedAssets.length > 0) {
    const fuelled = new Set(fuelledAssets.map((e) => e.assetId));
    const names = new Map(assetNames.map((a) => [a.id, a.name]));
    for (const m of movedAssets) {
      if (!m.assetId || fuelled.has(m.assetId)) continue;
      const km = Math.round(m._sum.distanceKm ?? 0);
      gaps.push({
        kind: "VEHICLE_NO_FUEL",
        label: `${names.get(m.assetId) ?? "A vehicle"} did ${m._count} trip${m._count === 1 ? "" : "s"}${km ? ` and ${km} km` : ""} with no cost recorded`,
        detail: "Nothing — no fuel, no tolls — was recorded against it. Either it ran on goodwill or the slips never came in.",
        subjectType: "asset",
        subjectId: m.assetId,
      });
    }
  }

  if (noDistance > 0) {
    gaps.push({
      kind: "TRIP_NO_DISTANCE",
      label: `${noDistance} trip${noDistance === 1 ? "" : "s"} ended with no distance`,
      detail: "No odometer reading, no phone track, nothing typed. They are left out of every per-kilometre figure rather than dragging it towards zero.",
    });
  }

  // Money recorded with no idea what it was for — real, but unapportionable.
  const untagged = expenses.filter((e) => !e.assetId && !e.tripId && !e.jobCardId && !e.transactionId);
  const untaggedCents = untagged.reduce((s, e) => s + e.amountCents, 0);
  if (recordedCents > 0 && untaggedCents / recordedCents > 0.4 && untaggedCents > 100_00) {
    gaps.push({
      kind: "UNTAGGED_SPEND",
      label: `${money(untaggedCents)} was recorded without saying what it was for`,
      detail: `${Math.round((untaggedCents / recordedCents) * 100)}% of recorded spend is tagged to no vehicle, job or trip, so it cannot be apportioned. Some of it is genuinely for nobody; most of it is not.`,
      cents: untaggedCents,
    });
  }

  const summary = summarise({ coveragePercent, hasBankFeed, recordedCents, unexplainedCents, gaps, money });

  return {
    from,
    to,
    recordedCents,
    recordedCount: expenses.length,
    unexplainedCents,
    unexplainedCount: unexplained._count,
    coveragePercent,
    hasBankFeed,
    bySource,
    gaps,
    summary,
  };
}

function summarise(p: {
  coveragePercent: number | null;
  hasBankFeed: boolean;
  recordedCents: number;
  unexplainedCents: number;
  gaps: CaptureGap[];
  money: (c: number) => string;
}): string {
  if (!p.hasBankFeed) {
    return p.recordedCents > 0
      ? `${p.money(p.recordedCents)} recorded. How much was not is unknown until a bank statement is imported.`
      : "Nothing recorded and no bank statement to check against.";
  }
  if (p.coveragePercent === null) return "";
  if (p.unexplainedCents === 0) {
    return `Every rand that left the bank is recorded — ${p.money(p.recordedCents)} over the period.`;
  }
  return `${p.coveragePercent}% of what left the bank is recorded. ${p.money(p.unexplainedCents)} went out and matches nothing.`;
}
