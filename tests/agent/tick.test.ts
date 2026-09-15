// The daily run.
//
// What matters is the order of what survives a short day: every workspace's
// officers do their rounds and its brief is built whether or not the model
// has time, and model work that does not fit before the deadline is left
// queued for the next run — not claimed and abandoned halfway.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { tickTenant } from "../../src/lib/agent/tick";

let tenantId: string;
let userId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Tick Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `tick-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  const party = await prisma.party.create({ data: { tenantId, name: "Ndlovu Traders", role: "CUSTOMER" } });
  // Work that never reached the books: something for the CFO to find.
  await prisma.transaction.create({
    data: { tenantId, partyId: party.id, type: "INVOICE", status: "SENT", amountCents: 48_000_00 },
  });
  // Something that happened, waiting for the agent to react to it.
  await prisma.domainEvent.create({
    data: { tenantId, type: "invoice.overdue", subjectType: "Transaction", subjectId: party.id },
  });
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.aiDraft.deleteMany({ where: { tenantId } });
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("the daily run", () => {
  it("does the rounds and builds the brief when there is no time left for the model", async () => {
    const out = await tickTenant(tenantId, new Date(), { deadline: Date.now() });

    expect(out.cfoObserved).toBeGreaterThan(0);
    expect(out.briefed).toBeGreaterThan(0);
    expect(out.deferred).toBe(true);
    expect(out.eventsHandled).toBe(0);
    expect(out.reviewed).toBe(false);
  });

  it("leaves the event queued for the next run rather than claiming it", async () => {
    await tickTenant(tenantId, new Date(), { deadline: Date.now() });

    const event = await prisma.domainEvent.findFirstOrThrow({ where: { tenantId } });
    expect(event.processedAt).toBeNull();
    // No run was started and cut off.
    expect(await prisma.agentRun.count({ where: { tenantId } })).toBe(0);
  });

  it("skips a workspace whose owner turned the officers off", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { agentProactiveEnabled: false } });
    const out = await tickTenant(tenantId, new Date(), { deadline: Date.now() });
    expect(out.skipped).toBe("proactive mode is off");
    expect(await prisma.observation.count({ where: { tenantId } })).toBe(0);
  });
});
