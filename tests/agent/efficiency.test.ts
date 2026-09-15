// The efficiency consultant.
//
// Like the CFO: silent on a tidy workspace, and one broken source must not
// cost the others. The consolidation engine's own arithmetic is tested in
// tests/core/consolidation.test.ts; here the question is whether what it
// finds reaches the bus with the effort attached.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { runEfficiency } from "../../src/lib/agent/officers/efficiency";
import { listOpen } from "../../src/lib/agent/observations";

let tenantId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Eff Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterEach(async () => {
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("the efficiency consultant", () => {
  it("says nothing about an empty workspace", async () => {
    const run = await runEfficiency(tenantId);
    expect(run.observed).toBe(0);
    expect(run.failed).toEqual([]);
    expect(run.checked).toBeGreaterThan(3);
  });

  it("carries a saving to the bus with the effort it would take", async () => {
    for (const [title, insurer] of [["Van", "Santam"], ["Bakkie", "Hollard"]] as const) {
      await prisma.obligation.create({
        data: { tenantId, kind: "INSURANCE", title, authority: insurer, dueAt: new Date(Date.now() + 100 * 86_400_000), recurrence: "ANNUAL", amountCents: 30_000_00 },
      });
    }
    const run = await runEfficiency(tenantId);
    expect(run.observed).toBe(1);

    const [o] = await listOpen(tenantId);
    expect(o.officer).toBe("EFFICIENCY");
    expect(o.dedupeKey).toBe("cons:insurance");
    expect(o.moneyCents).toBe(6_000_00);
    expect(o.headline).toContain("2 insurance policies");
    const evidence = o.evidence as Array<{ label: string; value: string }>;
    expect(evidence[0]).toEqual({ label: "Effort", value: "A phone call" });
  });

  it("supersedes rather than repeats on the next run", async () => {
    for (const [title, insurer] of [["Van", "Santam"], ["Bakkie", "Hollard"]] as const) {
      await prisma.obligation.create({
        data: { tenantId, kind: "INSURANCE", title, authority: insurer, dueAt: new Date(Date.now() + 100 * 86_400_000), recurrence: "ANNUAL", amountCents: 30_000_00 },
      });
    }
    await runEfficiency(tenantId);
    await runEfficiency(tenantId);
    expect(await listOpen(tenantId)).toHaveLength(1);
  });

  it("stays out of another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    await runEfficiency(other.id);
    expect(await prisma.observation.count({ where: { tenantId: other.id } })).toBe(0);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
