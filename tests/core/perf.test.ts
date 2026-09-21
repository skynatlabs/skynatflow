// The measuring instrument.
//
// Two things must hold or the instrument is worse than none: it must cost
// almost nothing on the ordinary path, and it must never be the reason a
// request fails. The sampling maths is the first; the fire-and-forget write
// is the second, and is asserted by the timings test passing at all.

import { describe, it, expect } from "vitest";
import { prisma } from "../../src/lib/db";
import { SAMPLE_ONE_IN, SLOW_QUERY_MS, operationTimings, purgeOldQuerySamples, shouldRecord } from "../../src/lib/perf";

describe("what gets recorded", () => {
  it("always records a slow query", () => {
    // Even on the unluckiest roll: slow queries are the ones worth reading.
    expect(shouldRecord(SLOW_QUERY_MS, 0.999999)).toBe(true);
    expect(shouldRecord(SLOW_QUERY_MS + 1, 0.999999)).toBe(true);
  });

  it("samples the rest at the stated rate", () => {
    expect(shouldRecord(1, 0)).toBe(true);
    expect(shouldRecord(1, 1 / SAMPLE_ONE_IN - 0.0001)).toBe(true);
    expect(shouldRecord(1, 1 / SAMPLE_ONE_IN)).toBe(false);
    expect(shouldRecord(1, 0.9)).toBe(false);
  });

  it("keeps the ordinary path overwhelmingly unrecorded", () => {
    // The instrument must be noise against the thing it measures.
    const rolls = Array.from({ length: 10_000 }, (_, i) => i / 10_000);
    const kept = rolls.filter((r) => shouldRecord(1, r)).length;
    expect(kept / rolls.length).toBeLessThan(0.05);
  });
});

describe("reading it back", () => {
  it("reports percentiles per operation, worst first", async () => {
    const op = `test.op.${Date.now()}`;
    const other = `test.other.${Date.now()}`;
    await prisma.querySample.createMany({
      data: [
        ...[10, 20, 30, 40, 900].map((ms) => ({ op, ms, slow: ms >= SLOW_QUERY_MS })),
        ...[1, 2, 3].map((ms) => ({ op: other, ms, slow: false })),
      ],
    });

    const rows = await operationTimings(prisma, 24);
    const mine = rows.find((r) => r.op === op);
    const theirs = rows.find((r) => r.op === other);

    expect(mine).toBeDefined();
    expect(mine!.samples).toBe(5);
    expect(mine!.worst).toBe(900);
    expect(mine!.slow).toBe(1);
    // p95 of five samples is the slowest of them.
    expect(mine!.p95).toBe(900);
    expect(mine!.p50).toBeGreaterThanOrEqual(30);

    // Sorted by p95 descending, so the slow one outranks the quick one.
    expect(rows.indexOf(mine!)).toBeLessThan(rows.indexOf(theirs!));

    await prisma.querySample.deleteMany({ where: { op: { in: [op, other] } } });
  });

  it("forgets samples past the retention window", async () => {
    const op = `test.old.${Date.now()}`;
    await prisma.querySample.create({
      data: { op, ms: 5, at: new Date(Date.now() - 40 * 86_400_000) },
    });
    await purgeOldQuerySamples(prisma, 14);
    expect(await prisma.querySample.count({ where: { op } })).toBe(0);
  });

  it("never records the instrument measuring itself", async () => {
    // A QuerySample write that recorded a QuerySample write would not stop.
    const before = await prisma.querySample.count();
    await prisma.querySample.findMany({ take: 1 });
    const after = await prisma.querySample.count();
    expect(after).toBe(before);
  });
});
