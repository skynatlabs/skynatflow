// The value ledger.
//
// The property that matters is honesty: found, taken on and verified are
// three different numbers, each written once, and verified is written only
// when the data actually shows the outcome.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { observe, decide } from "../../src/lib/agent/observations";
import { buildBrief } from "../../src/lib/agent/chiefOfStaff";
import { submitExpense, markDuplicate } from "../../src/lib/core/expenses";
import { realiseValue, recordPlatformCost, valueSummary } from "../../src/lib/core/valueLedger";

let tenantId: string;
let ownerId: string;
let userId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Value Co", niche: "SERVICES", monthlyFeeCents: 499_00 } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `value-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
});

afterEach(async () => {
  await prisma.valueEntry.deleteMany({ where: { tenantId } });
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

const entries = (kind: "IDENTIFIED" | "ACCEPTED" | "REALISED" | "COST") =>
  prisma.valueEntry.findMany({ where: { tenantId, kind } });

describe("found, taken on, verified", () => {
  it("writes found once when a finding reaches a person, and taken on once when they say yes", async () => {
    await observe({ tenantId, officer: "CFO", headline: "Money.", dedupeKey: "cfo:x", moneyCents: 5_000_00, confidence: 90 });

    const brief = await buildBrief(tenantId);
    expect(brief.items).toHaveLength(1);
    expect(await entries("IDENTIFIED")).toHaveLength(1);

    // Raising it again — a superseding row on the same key — does not count twice.
    await observe({ tenantId, officer: "CFO", headline: "Money, still.", dedupeKey: "cfo:x", moneyCents: 5_500_00, confidence: 90 });
    await buildBrief(tenantId);
    expect(await entries("IDENTIFIED")).toHaveLength(1);

    const open = await prisma.observation.findFirst({ where: { tenantId, dedupeKey: "cfo:x", status: "RAISED" } });
    await decide({ tenantId, observationId: open!.id, actioned: true, byId: ownerId });
    const accepted = await entries("ACCEPTED");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].cents).toBe(5_500_00);
  });

  it("writes nothing for a finding with no money on it", async () => {
    await observe({ tenantId, officer: "SALES", headline: "Quiet customer.", dedupeKey: "sales:q", confidence: 60 });
    await buildBrief(tenantId);
    expect(await entries("IDENTIFIED")).toHaveLength(0);
  });

  it("writes nothing when a finding is dismissed", async () => {
    await observe({ tenantId, officer: "CFO", headline: "Money.", dedupeKey: "cfo:y", moneyCents: 1_000_00, confidence: 90 });
    const brief = await buildBrief(tenantId);
    await decide({ tenantId, observationId: brief.items[0].observationId, actioned: false });
    expect(await entries("ACCEPTED")).toHaveLength(0);
  });
});

describe("verification", () => {
  it("verifies a duplicate only once it is actually marked, and only once", async () => {
    const a = await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 800_00 });
    const b = await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel again", amountCents: 800_00 });
    await observe({
      tenantId, officer: "CFO", headline: "Twice.", dedupeKey: `cfo:duplicate:${b.id}`,
      subjectType: "expense", subjectId: b.id, moneyCents: 800_00, confidence: 70,
    });
    const brief = await buildBrief(tenantId);
    await decide({ tenantId, observationId: brief.items[0].observationId, actioned: true });

    // Accepted, but nothing has changed in the data yet.
    expect(await realiseValue(tenantId)).toBe(0);

    await markDuplicate(tenantId, b.id, a.id);
    expect(await realiseValue(tenantId)).toBe(1);
    expect(await realiseValue(tenantId)).toBe(0);

    const [r] = await entries("REALISED");
    expect(r.cents).toBe(800_00);
    expect(r.method).toContain("duplicate");
  });

  it("leaves a finding it cannot check as accepted, not verified", async () => {
    await observe({ tenantId, officer: "CFO", headline: "Overdue.", dedupeKey: "cfo:overdue-debtors", moneyCents: 9_000_00, confidence: 100 });
    const brief = await buildBrief(tenantId);
    await decide({ tenantId, observationId: brief.items[0].observationId, actioned: true });
    expect(await realiseValue(tenantId)).toBe(0);
    expect(await entries("REALISED")).toHaveLength(0);
  });
});

describe("cost and the summary", () => {
  it("writes the platform fee once a month, whatever the tick does", async () => {
    await recordPlatformCost(tenantId);
    await recordPlatformCost(tenantId);
    const cost = await entries("COST");
    expect(cost).toHaveLength(1);
    expect(cost[0].cents).toBe(499_00);
  });

  it("nets verified against cost and says when the fee was never set", async () => {
    await recordPlatformCost(tenantId);
    let v = await valueSummary(tenantId);
    expect(v.feeSet).toBe(true);
    expect(v.netVerifiedCents).toBe(-499_00);
    expect(v.months).toHaveLength(3);

    await prisma.tenant.update({ where: { id: tenantId }, data: { monthlyFeeCents: null } });
    v = await valueSummary(tenantId);
    expect(v.feeSet).toBe(false);
  });
});
