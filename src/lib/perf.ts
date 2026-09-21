// Measuring, so that "is it fast" stops being an opinion.
//
// The audit's most uncomfortable finding was not that the app is slow — it is
// that nothing measured it, so nobody could say either way while claiming to
// beat a competitor whose most-cited weakness is being slow.
//
// This is the cheapest honest instrument. In a server-rendered application
// the time goes to the database, and every query in this codebase passes
// through one Prisma client, so one extension sees all of them.
//
// Three properties keep it from costing more than it measures:
//
//   SLOW ALWAYS, THE REST SAMPLED. A query over the threshold is always
//   recorded, because those are the ones worth reading. Everything else is
//   sampled at a rate low enough that the recording is noise against the
//   thing being recorded.
//
//   NEVER THE ARGUMENTS. Only the model and the operation. A timing table
//   that captured `where` clauses would quietly become a second copy of the
//   business's data with none of its protections.
//
//   IT CANNOT BREAK A REQUEST. Recording is fire-and-forget and swallows its
//   own failures. A page must never fail because the instrument did.

import type { PrismaClient } from "@prisma/client";

/** Over this, a query is recorded rather than sampled. */
export const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 400);

/** One in this many ordinary queries is kept, for the percentiles. */
export const SAMPLE_ONE_IN = Number(process.env.QUERY_SAMPLE_ONE_IN ?? 50);

/**
 * Whether to record this one at all.
 *
 * Exported so the test can reason about it without a database.
 */
export function shouldRecord(ms: number, roll = Math.random()): boolean {
  if (ms >= SLOW_QUERY_MS) return true;
  return roll < 1 / SAMPLE_ONE_IN;
}

/**
 * Wrap a client so every query through it is timed.
 *
 * Returns a client, so the caller replaces theirs with it. The recording
 * write goes through the UNDERLYING client rather than the wrapped one,
 * because a wrapped write would be timed, which would record a write, which
 * would be timed.
 */
export function withQueryTiming<T extends PrismaClient>(client: T): T {
  const record = (op: string, ms: number) => {
    // Deliberately not awaited. A request should not wait on its own
    // instrumentation, and a failure here is not the request's problem.
    void client.querySample
      .create({ data: { op, ms: Math.round(ms), slow: ms >= SLOW_QUERY_MS } })
      .catch(() => {});
  };

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const started = performance.now();
          try {
            return await query(args);
          } finally {
            const ms = performance.now() - started;
            // Never instrument the instrument.
            if (model !== "QuerySample" && shouldRecord(ms)) {
              record(`${model ?? "raw"}.${operation}`, ms);
            }
          }
        },
      },
    },
  }) as unknown as T;
}

export interface OperationTiming {
  op: string;
  samples: number;
  p50: number;
  p95: number;
  worst: number;
  /** How many of these crossed the slow line. */
  slow: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/**
 * What the database has been doing, worst first.
 *
 * p95 rather than an average, because an average is what hides the one page
 * in twenty that takes nine seconds — and that page is the whole reason
 * somebody says the product feels slow.
 */
export async function operationTimings(
  client: PrismaClient,
  sinceHours = 24,
  now = new Date()
): Promise<OperationTiming[]> {
  const rows = await client.querySample.findMany({
    where: { at: { gte: new Date(now.getTime() - sinceHours * 3_600_000) } },
    select: { op: true, ms: true, slow: true },
    // A day of sampling at one in fifty is small; this is the guard against
    // an unexpected flood, not an expected size.
    take: 50_000,
  });

  const byOp = new Map<string, { ms: number[]; slow: number }>();
  for (const row of rows) {
    const entry = byOp.get(row.op) ?? { ms: [], slow: 0 };
    entry.ms.push(row.ms);
    if (row.slow) entry.slow += 1;
    byOp.set(row.op, entry);
  }

  return [...byOp.entries()]
    .map(([op, entry]) => {
      const sorted = [...entry.ms].sort((a, b) => a - b);
      return {
        op,
        samples: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        worst: sorted[sorted.length - 1] ?? 0,
        slow: entry.slow,
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}

/** Older than this and it is history nobody will read. */
export async function purgeOldQuerySamples(
  client: PrismaClient,
  olderThanDays = 14,
  now = new Date()
): Promise<number> {
  const { count } = await client.querySample.deleteMany({
    where: { at: { lt: new Date(now.getTime() - olderThanDays * 86_400_000) } },
  });
  return count;
}
