// The compliance watch. Two properties matter more than the wording:
// it must fire when a deadline worsens, and it must go quiet afterwards.
// A proactive feature that repeats itself gets muted, and a muted warning
// about a lapsing company registration is worse than no feature at all.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { runComplianceWatch } from "../../src/lib/agent/complianceWatch";
import { addObligation } from "../../src/lib/core/obligations";

let tenantId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Watch Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

const JUNE = new Date("2026-06-01T09:00:00Z");

describe("runComplianceWatch", () => {
  it("says nothing when everything is far off", async () => {
    await addObligation({
      tenantId,
      kind: "LICENCE",
      title: "Trading licence",
      dueAt: new Date("2026-12-01T12:00:00Z"),
      leadDays: 30,
    });

    const out = await runComplianceWatch(tenantId, JUNE);
    expect(out.raised).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(0);
  });

  it("raises once, then stays quiet while nothing changes", async () => {
    await addObligation({
      tenantId,
      kind: "COMPLIANCE_FILING",
      title: "CIPC annual return",
      dueAt: new Date("2026-05-20T12:00:00Z"),
      severity: "CRITICAL",
      consequence: "The company gets deregistered and the bank account freezes.",
    });

    const first = await runComplianceWatch(tenantId, JUNE);
    expect(first.raised).toBe(1);

    // Same day, a tick later. The deadline has not moved, so neither should
    // the owner's phone.
    const second = await runComplianceWatch(tenantId, new Date("2026-06-01T09:15:00Z"));
    expect(second.raised).toBe(0);

    expect(await prisma.notification.count({ where: { tenantId } })).toBe(1);
  });

  it("speaks again when the state genuinely worsens", async () => {
    await addObligation({
      tenantId,
      kind: "TAX",
      title: "VAT201",
      dueAt: new Date("2026-06-05T12:00:00Z"),
      leadDays: 10,
      severity: "HIGH",
    });

    // 1 June: four days out, inside the ten-day lead — SOON.
    expect((await runComplianceWatch(tenantId, JUNE)).raised).toBe(1);
    // 3 June: still SOON. Nothing new to say.
    expect((await runComplianceWatch(tenantId, new Date("2026-06-03T09:00:00Z"))).raised).toBe(0);
    // 5 June: DUE. Worth saying.
    expect((await runComplianceWatch(tenantId, new Date("2026-06-05T09:00:00Z"))).raised).toBe(1);
    // 8 June: OVERDUE. Worth saying again.
    expect((await runComplianceWatch(tenantId, new Date("2026-06-08T09:00:00Z"))).raised).toBe(1);

    expect(await prisma.notification.count({ where: { tenantId } })).toBe(3);
  });

  it("leads with what is blocking work and names the consequence", async () => {
    const user = await prisma.user.create({
      data: { email: `watch-${tenantId}@test.local`, name: "Driver" },
    });
    const m = await prisma.membership.create({
      data: { tenantId, userId: user.id, role: "DRIVER" },
    });

    // A mild thing and a work-stopping thing on the same tick. The title has
    // to be about the one that stops work.
    await addObligation({
      tenantId,
      kind: "LICENCE",
      title: "Trading licence",
      dueAt: new Date("2026-06-04T12:00:00Z"),
      leadDays: 30,
      severity: "MEDIUM",
    });
    await addObligation({
      tenantId,
      kind: "DOCUMENT",
      title: "Professional driving permit",
      dueAt: new Date("2026-05-15T12:00:00Z"),
      blocksWork: true,
      severity: "HIGH",
      consequence: "Driving without a valid PDP voids the insurance on the load.",
      membershipId: m.id,
    });

    const out = await runComplianceWatch(tenantId, JUNE);
    expect(out.raised).toBe(2);
    expect(out.blocking).toBe(1);

    const note = await prisma.notification.findFirst({ where: { tenantId } });
    expect(note!.title).toContain("work is blocked");
    expect(note!.body).toContain("voids the insurance");
    // The subject is named, because "a PDP expired" is not actionable and
    // "Driver's PDP expired" is.
    expect(note!.body).toContain("Driver");

    await prisma.obligation.deleteMany({ where: { tenantId } });
    await prisma.membership.delete({ where: { id: m.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("gives both dates for a contract with a notice window", async () => {
    await addObligation({
      tenantId,
      kind: "CONTRACT",
      title: "Cleaning contract",
      dueAt: new Date("2026-07-01T12:00:00Z"),
      noticeDays: 30,
      autoRenews: true,
      leadDays: 45,
    });

    await runComplianceWatch(tenantId, JUNE);
    const note = await prisma.notification.findFirst({ where: { tenantId } });
    // Useless without both: one is when to act, the other is what happens.
    expect(note!.body).toContain("2026-06-01");
    expect(note!.body).toContain("2026-07-01");
    expect(note!.body).toContain("Notice has to be given");
  });
});
