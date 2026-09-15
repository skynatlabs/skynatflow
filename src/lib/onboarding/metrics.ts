// How long moving in actually takes.
//
// The target is ten minutes from signing up to the first quote sent. A target
// nobody measures is a slogan, so this reads the real timestamps: when the
// workspace was created, when setting up was finished, when the first quote
// went out, and — for the ones that never finished — which step they were on
// when they stopped. That last number is the one worth acting on.

import { prisma } from "@/lib/db";
import { STEPS, type StepKey } from "./progress";

export interface MovingInMetrics {
  since: Date;
  started: number;
  finished: number;
  quoted: number;
  /** Minutes, median, for the ones that got there. */
  medianMinutesToFinish: number | null;
  medianMinutesToFirstQuote: number | null;
  withinTenMinutes: number;
  /** Where the unfinished ones stopped. */
  stalledAt: Array<{ step: StepKey; label: string; count: number }>;
  recent: Array<{
    id: string;
    name: string;
    createdAt: Date;
    minutesToFinish: number | null;
    minutesToFirstQuote: number | null;
    step: string | null;
  }>;
}

const minutes = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

export async function movingInMetrics(days = 30, now = new Date()): Promise<MovingInMetrics> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const tenants = await prisma.tenant.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, onboardedAt: true, firstQuoteSentAt: true, onboardingStep: true },
  });

  const toFinish: number[] = [];
  const toQuote: number[] = [];
  const stalled = new Map<StepKey, number>();

  for (const t of tenants) {
    if (t.onboardedAt) toFinish.push(minutes(t.createdAt, t.onboardedAt));
    else {
      const step = (t.onboardingStep ?? "business") as StepKey;
      stalled.set(step, (stalled.get(step) ?? 0) + 1);
    }
    if (t.firstQuoteSentAt) toQuote.push(minutes(t.createdAt, t.firstQuoteSentAt));
  }

  return {
    since,
    started: tenants.length,
    finished: toFinish.length,
    quoted: toQuote.length,
    medianMinutesToFinish: median(toFinish),
    medianMinutesToFirstQuote: median(toQuote),
    withinTenMinutes: toFinish.filter((m) => m <= 10).length,
    stalledAt: STEPS.map((s) => ({ step: s.key, label: s.label, count: stalled.get(s.key) ?? 0 })).filter((s) => s.count > 0),
    recent: tenants.slice(0, 25).map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      minutesToFinish: t.onboardedAt ? minutes(t.createdAt, t.onboardedAt) : null,
      minutesToFirstQuote: t.firstQuoteSentAt ? minutes(t.createdAt, t.firstQuoteSentAt) : null,
      step: t.onboardedAt ? null : t.onboardingStep ?? "business",
    })),
  };
}
