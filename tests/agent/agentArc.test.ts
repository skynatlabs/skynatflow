// Undo, budget, failover, learning and recipes.
//
// These are the five things that make an agent acting on a business
// trustworthy rather than alarming, and each has one property that carries
// the weight: undo must never reach another workspace, the budget must never
// stop a person who is asking, failover must not retry a refusal, learning
// must not turn a preference into a gag, and a recipe must never widen what a
// role may do.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { recordUndo, undo, undoHealth, undoRun, undoable } from "../../src/lib/agent/undo";
import { costOf, mayRun, recordSpend, setMonthlyCap, spendByAgent, spendThisMonth } from "../../src/lib/agent/budget";
import { worthFailingOver, ANTHROPIC_MODEL } from "../../src/lib/ai/model";
import { acceptanceByKind, howItIsDoing, preferenceNotes } from "../../src/lib/agent/learning";
import { availableRecipes, installRecipe, seedBuiltInRecipes } from "../../src/lib/agent/recipes";

const DAY = 86_400_000;

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let otherPartyId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  partyId = (await prisma.party.create({ data: { tenantId, name: "Jabu", role: "CUSTOMER", notes: "the original" } })).id;
  otherPartyId = (await prisma.party.create({ data: { tenantId: otherTenantId, name: "Thabo", role: "CUSTOMER" } })).id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.agentUndo.deleteMany({ where: { tenantId: id } });
    await prisma.agentSpend.deleteMany({ where: { tenantId: id } });
    await prisma.agentRecipe.deleteMany({ where: { tenantId: id } });
    await prisma.agentDefinition.deleteMany({ where: { tenantId: id } });
    await prisma.observation.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id, parentId: { not: null } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("undo", () => {
  it("puts a field back to what it was, once", async () => {
    await prisma.party.update({ where: { id: partyId }, data: { notes: "changed by the agent" } });
    const record = await recordUndo({
      tenantId,
      tool: "updateCustomerDetails",
      description: "Changed Jabu's note",
      compensation: { kind: "restore", model: "party", id: partyId, fields: { notes: "the original" } },
    });

    await undo({ tenantId, undoId: record!.id });
    expect((await prisma.party.findUniqueOrThrow({ where: { id: partyId } })).notes).toBe("the original");

    await expect(undo({ tenantId, undoId: record!.id })).rejects.toThrow(/already been put back/i);
  });

  it("removes something that was created", async () => {
    const created = await prisma.party.create({ data: { tenantId, name: "Made by the agent", role: "CUSTOMER" } });
    const record = await recordUndo({
      tenantId,
      tool: "createCustomer",
      description: "Added a customer",
      compensation: { kind: "delete", model: "party", id: created.id },
    });

    await undo({ tenantId, undoId: record!.id });
    expect(await prisma.party.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("never reaches into another workspace, even with a stored id", async () => {
    // A record that names another workspace's row. The undo has to re-check
    // the tenant on the target rather than trust what was written down.
    const record = await prisma.agentUndo.create({
      data: {
        tenantId,
        tool: "updateCustomerDetails",
        description: "Reaching somewhere it should not",
        compensation: { kind: "delete", model: "party", id: otherPartyId },
        expiresAt: new Date(Date.now() + DAY),
      },
    });

    await expect(undo({ tenantId, undoId: record.id })).rejects.toThrow(/no longer there/i);
    expect(await prisma.party.findUnique({ where: { id: otherPartyId } })).not.toBeNull();
  });

  it("refuses once the week is up, and says why", async () => {
    const record = await prisma.agentUndo.create({
      data: {
        tenantId,
        tool: "createTask",
        description: "Something from a fortnight ago",
        compensation: { kind: "delete", model: "party", id: partyId },
        expiresAt: new Date(Date.now() - DAY),
      },
    });
    await expect(undo({ tenantId, undoId: record.id })).rejects.toThrow(/the world has moved on/i);
    expect(await undoable(tenantId)).toHaveLength(0);
  });

  it("will not record an undo for a model it cannot put back", async () => {
    const record = await recordUndo({
      tenantId,
      tool: "somethingElse",
      description: "Not undoable",
      compensation: { kind: "delete", model: "bankTransaction", id: "x" },
    });
    // Not an error — the action still worked, it is simply not offered as
    // undoable rather than failing the thing that just succeeded.
    expect(record).toBeNull();
  });

  it("puts a whole run back, newest change first", async () => {
    const a = await prisma.party.create({ data: { tenantId, name: "One", role: "CUSTOMER" } });
    const b = await prisma.party.create({ data: { tenantId, name: "Two", role: "CUSTOMER" } });
    for (const party of [a, b]) {
      await recordUndo({
        tenantId,
        runId: "run-1",
        tool: "createCustomer",
        description: `Added ${party.name}`,
        compensation: { kind: "delete", model: "party", id: party.id },
      });
    }

    const result = await undoRun({ tenantId, runId: "run-1" });
    expect(result).toMatchObject({ undone: 2, failed: 0 });
    expect(await prisma.party.count({ where: { tenantId } })).toBe(1);

    const health = await undoHealth(tenantId);
    expect(health.alreadyUndone).toBe(2);
  });
});

describe("the budget", () => {
  it("costs a run from the tokens it used", () => {
    const cents = costOf({ model: ANTHROPIC_MODEL, inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(cents).toBeGreaterThan(0);
    // Output costs more than input, on every provider worth using.
    const outputHeavy = costOf({ model: ANTHROPIC_MODEL, inputTokens: 100_000, outputTokens: 1_000_000 });
    expect(outputHeavy).toBeGreaterThan(cents);
  });

  it("never stops somebody who is sitting there asking", async () => {
    await setMonthlyCap(tenantId, 100);
    await recordSpend({ tenantId, provider: "anthropic", model: ANTHROPIC_MODEL, inputTokens: 5_000_000, outputTokens: 5_000_000 });

    const spend = await spendThisMonth(tenantId);
    expect(spend.overBudget).toBe(true);

    const asking = await mayRun({ tenantId, userPresent: true });
    expect(asking.allowed).toBe(true);

    const background = await mayRun({ tenantId, userPresent: false });
    expect(background.allowed).toBe(false);
    expect(background.reason).toMatch(/asking it something directly still works/i);
  });

  it("lets everything through when no cap is set", async () => {
    await recordSpend({ tenantId, provider: "anthropic", model: ANTHROPIC_MODEL, inputTokens: 9_000_000, outputTokens: 9_000_000 });
    expect((await mayRun({ tenantId, userPresent: false })).allowed).toBe(true);
  });

  it("says where the money went", async () => {
    const agent = await prisma.agentDefinition.create({
      data: { tenantId, name: "The chaser", brief: "chase", toolNames: [] },
    });
    await recordSpend({ tenantId, agentId: agent.id, provider: "anthropic", model: ANTHROPIC_MODEL, inputTokens: 500_000, outputTokens: 200_000 });
    await recordSpend({ tenantId, provider: "anthropic", model: ANTHROPIC_MODEL, inputTokens: 10_000, outputTokens: 5_000 });

    const rows = await spendByAgent(tenantId);
    expect(rows[0].name).toBe("The chaser");
    expect(rows.find((r) => r.name === "The main assistant")).toBeTruthy();
  });
});

describe("failover", () => {
  it("retries what might work elsewhere and not what will not", () => {
    for (const message of ["Rate limit exceeded", "503 Service Unavailable", "fetch failed", "request timed out", "insufficient credit"]) {
      expect(worthFailingOver(new Error(message)), message).toBe(true);
    }
    // A refusal or a bad request fails the same way at every vendor, more
    // slowly and at twice the cost.
    for (const message of ["invalid tool schema", "content filter triggered", "the model refused", "unsupported parameter"]) {
      expect(worthFailingOver(new Error(message)), message).toBe(false);
    }
  });
});

describe("learning from what they accept", () => {
  async function observation(kind: string, status: "ACTIONED" | "DISMISSED" | "RAISED", subjectId?: string) {
    return prisma.observation.create({
      data: {
        tenantId,
        officer: "CFO",
        dedupeKey: `${kind}:${Math.random()}`,
        headline: "Something",
        confidence: 80,
        status,
        decidedAt: status === "RAISED" ? null : new Date(Date.now() - 5 * DAY),
        ...(subjectId ? { subjectType: "Transaction", subjectId } : {}),
      },
    });
  }

  it("counts by kind and phrases a refusal as taste rather than a gag", async () => {
    for (let i = 0; i < 5; i++) await observation("cfo:tiny-thing", "DISMISSED");
    for (let i = 0; i < 5; i++) await observation("cfo:overdue", "ACTIONED");

    const rates = await acceptanceByKind(tenantId);
    const refused = rates.find((r) => r.kind === "cfo:tiny-thing")!;
    expect(refused.rejected).toBe(5);
    expect(refused.acceptRate).toBe(0);

    const notes = await preferenceNotes(tenantId);
    const line = notes.find((n) => n.includes("cfo:tiny-thing"))!;
    // Preference, not prohibition — one that has been refused four times may
    // be genuinely urgent the fifth, and a hard rule would bury it.
    expect(line).toMatch(/raise one only when it is materially worse/i);
    expect(notes.some((n) => n.includes("cfo:overdue") && /worth raising early/i.test(n))).toBe(true);
  });

  it("says nothing about a kind nobody has decided on enough times", async () => {
    for (let i = 0; i < 2; i++) await observation("cfo:new-thing", "DISMISSED");
    expect(await preferenceNotes(tenantId)).toEqual([]);
  });

  it("measures the outcome as correlation and says so", async () => {
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "PAID", amountCents: 100_000 },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 100_000, parentId: invoice.id, createdAt: new Date(Date.now() - 2 * DAY) },
    });
    await observation("cfo:overdue", "ACTIONED", invoice.id);

    const doing = await howItIsDoing(tenantId);
    expect(doing.outcomes).toHaveLength(1);
    expect(doing.outcomes[0].note).toMatch(/followed by, not necessarily because of/i);
  });
});

describe("recipes", () => {
  it("offers only the ones that suit the trade, and marks what is installed", async () => {
    await seedBuiltInRecipes();

    const forServices = await availableRecipes(tenantId);
    expect(forServices.some((r) => r.slug === "week-ahead")).toBe(true);
    // Stock watching is for a shop, not a plumber.
    expect(forServices.some((r) => r.slug === "stock-watch")).toBe(false);
    // And the ones with no trade on them suit everybody.
    expect(forServices.some((r) => r.slug === "debtor-chaser")).toBe(true);

    await installRecipe({ tenantId, slug: "debtor-chaser", role: "OWNER" });
    expect((await availableRecipes(tenantId)).find((r) => r.slug === "debtor-chaser")!.alreadyInstalled).toBe(true);
  });

  it("narrows the tools to what the role may do and never widens them", async () => {
    await seedBuiltInRecipes();

    const asOwner = await installRecipe({ tenantId, slug: "debtor-chaser", role: "OWNER" });
    expect(asOwner.toolsNotAvailable).toEqual([]);

    // A driver cannot draft a chaser, and the install says so rather than
    // quietly granting it.
    const asDriver = await installRecipe({ tenantId, slug: "debtor-chaser", role: "DRIVER" });
    expect(asDriver.toolsNotAvailable).toContain("draftTheChase");
    expect(asDriver.toolsGranted).toBeLessThan(asOwner.toolsGranted);

    const agent = await prisma.agentDefinition.findFirstOrThrow({ where: { tenantId } });
    expect(agent.toolNames).not.toContain("draftTheChase");
  });

  it("installs an update rather than a second copy of the same agent", async () => {
    await seedBuiltInRecipes();
    await installRecipe({ tenantId, slug: "debtor-chaser", role: "OWNER" });
    await installRecipe({ tenantId, slug: "debtor-chaser", role: "OWNER" });
    expect(await prisma.agentDefinition.count({ where: { tenantId } })).toBe(1);
  });

  it("refuses a recipe that does not exist", async () => {
    await expect(installRecipe({ tenantId, slug: "nope", role: "OWNER" })).rejects.toThrow(/no such recipe/i);
  });
});
