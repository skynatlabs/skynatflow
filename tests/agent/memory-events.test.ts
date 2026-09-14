// Memory and the event bus, against a real database.
//
// The properties that matter here are all about not doing something twice:
// a fact must be corrected rather than duplicated, and two overlapping ticks
// must not both react to the same overdue invoice and send one customer two
// chasers.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  resolveThread,
  loadThread,
  appendToThread,
  loadFacts,
  rememberFact,
  forgetFact,
} from "../../src/lib/agent/memory";
import { emitEvent, claimPendingEvents, isActionable } from "../../src/lib/agent/events";

let tenantId: string;
let otherTenantId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Memory Co", niche: "SERVICES" } });
  const o = await prisma.tenant.create({ data: { name: "Memory Other Co", niche: "RETAIL" } });
  tenantId = t.id;
  otherTenantId = o.id;
});

afterAll(async () => {
  for (const t of [tenantId, otherTenantId]) {
    await prisma.agentMessage.deleteMany({ where: { thread: { tenantId: t } } });
    await prisma.agentRun.deleteMany({ where: { tenantId: t } });
    await prisma.agentThread.deleteMany({ where: { tenantId: t } });
    await prisma.tenantFact.deleteMany({ where: { tenantId: t } });
    await prisma.domainEvent.deleteMany({ where: { tenantId: t } });
    await prisma.party.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }
});

describe("threads", () => {
  it("creates a thread and reads its turns back in order", async () => {
    const threadId = await resolveThread({ tenantId, userId: "u1" });
    await appendToThread(threadId, [
      { role: "user", content: "who owes us money" },
      { role: "assistant", content: "Three customers." },
    ]);

    const turns = await loadThread(threadId, tenantId);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", content: "who owes us money" });
    expect(turns[1].role).toBe("assistant");
  });

  it("reuses a thread when given its id", async () => {
    const first = await resolveThread({ tenantId, userId: "u1" });
    const again = await resolveThread({ tenantId, userId: "u1", threadId: first });
    expect(again).toBe(first);
  });

  it("refuses a thread id from another tenant and starts a fresh one", async () => {
    const foreign = await resolveThread({ tenantId: otherTenantId, userId: "u9" });
    const mine = await resolveThread({ tenantId, userId: "u1", threadId: foreign });
    expect(mine).not.toBe(foreign);

    const row = await prisma.agentThread.findUnique({ where: { id: mine } });
    expect(row?.tenantId).toBe(tenantId);
  });

  it("never returns another tenant's turns", async () => {
    const foreign = await resolveThread({ tenantId: otherTenantId, userId: "u9" });
    await appendToThread(foreign, [{ role: "user", content: "secret" }]);
    const turns = await loadThread(foreign, tenantId); // wrong tenant
    expect(turns).toHaveLength(0);
  });
});

describe("facts", () => {
  it("corrects a fact in place rather than accumulating contradictions", async () => {
    await rememberFact({ tenantId, key: "acme.payment", value: "always pays late" });
    await rememberFact({ tenantId, key: "acme.payment", value: "pays on time since March" });

    const facts = await loadFacts(tenantId);
    const matching = facts.filter((f) => f.startsWith("acme.payment"));
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain("since March");
  });

  it("keeps facts scoped to their tenant", async () => {
    await rememberFact({ tenantId: otherTenantId, key: "other.secret", value: "not yours" });
    const facts = await loadFacts(tenantId);
    expect(facts.some((f) => f.includes("not yours"))).toBe(false);
  });

  it("forgets a fact the owner says is wrong", async () => {
    await rememberFact({ tenantId, key: "wrong.fact", value: "nonsense" });
    await forgetFact(tenantId, "wrong.fact");
    const facts = await loadFacts(tenantId);
    expect(facts.some((f) => f.startsWith("wrong.fact"))).toBe(false);
  });
});

describe("events", () => {
  it("queues actionable types and pre-resolves the rest", async () => {
    expect(isActionable("invoice.overdue")).toBe(true);
    expect(isActionable("invoice.paid")).toBe(false);

    await emitEvent({
      tenantId,
      type: "invoice.paid",
      subjectType: "Transaction",
      subjectId: "t-paid",
    });
    const claimed = await claimPendingEvents(tenantId);
    // Good news needs no intervention, so it never enters the queue.
    expect(claimed.some((e) => e.type === "invoice.paid")).toBe(false);
  });

  it("hands an actionable event to exactly one claimer", async () => {
    await emitEvent({
      tenantId,
      type: "invoice.overdue",
      subjectType: "Transaction",
      subjectId: "t-overdue-1",
      payload: { amountCents: 50000 },
    });

    const first = await claimPendingEvents(tenantId);
    expect(first.some((e) => e.subjectId === "t-overdue-1")).toBe(true);

    // A second tick overlapping the first must find nothing left to take.
    const second = await claimPendingEvents(tenantId);
    expect(second.some((e) => e.subjectId === "t-overdue-1")).toBe(false);
  });

  it("never hands one tenant another tenant's events", async () => {
    await emitEvent({
      tenantId: otherTenantId,
      type: "payment.failed",
      subjectType: "Transaction",
      subjectId: "t-foreign",
    });
    const claimed = await claimPendingEvents(tenantId);
    expect(claimed.some((e) => e.subjectId === "t-foreign")).toBe(false);
  });

  it("survives a bad payload instead of failing the business operation", async () => {
    // Emission is fire-and-forget on purpose: nobody's payment should roll
    // back because the agent's inbox was unavailable.
    await expect(
      emitEvent({
        tenantId: "does-not-exist",
        type: "invoice.overdue",
        subjectType: "Transaction",
        subjectId: "x",
      })
    ).resolves.toBeUndefined();
  });
});
