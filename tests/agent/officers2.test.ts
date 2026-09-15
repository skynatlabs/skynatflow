// The COO, the sales consultant, the legal consultant, shared memory,
// handoffs, industry packs and turnaround mode.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { runCOO } from "../../src/lib/agent/officers/coo";
import { runSales } from "../../src/lib/agent/officers/sales";
import { runLegal } from "../../src/lib/agent/officers/legal";
import { observe, decide, listOpen, sharedMemory } from "../../src/lib/agent/observations";
import { currentBrief } from "../../src/lib/agent/chiefOfStaff";
import { setCeiling } from "../../src/lib/agent/ladder";
import { weightFor } from "../../src/lib/core/industryPacks";

let tenantId: string;
let ownerId: string;
let userId: string;
const DAY = 86_400_000;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Officers Co", niche: "LOGISTICS" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `off2-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
});

afterEach(async () => {
  await prisma.aiDraft.deleteMany({ where: { tenantId } });
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.observation.deleteMany({ where: { tenantId } });
  await prisma.officerAutonomy.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.employmentRecord.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("the COO", () => {
  it("is silent on an empty workspace", async () => {
    const r = await runCOO(tenantId);
    expect(r.observed).toBe(0);
    expect(r.failed).toEqual([]);
  });

  it("books a due service as a task only when allowed to act, and raises it either way", async () => {
    const truck = await prisma.asset.create({ data: { tenantId, name: "Truck", serviceIntervalKm: 10_000, lastServiceKm: 50_000 } });
    await prisma.expense.create({ data: { tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 100_00, assetId: truck.id, odometerKm: 59_600 } });

    await runCOO(tenantId);
    expect((await listOpen(tenantId)).some((o) => o.dedupeKey === `coo:service:${truck.id}`)).toBe(true);
    expect(await prisma.task.count({ where: { tenantId } })).toBe(0); // default ceiling PROPOSE

    await setCeiling({ tenantId, officer: "COO", ceiling: "ACT" });
    await runCOO(tenantId);
    expect(await prisma.task.count({ where: { tenantId } })).toBe(1);
    await runCOO(tenantId);
    expect(await prisma.task.count({ where: { tenantId } })).toBe(1); // never twice
  });
});

describe("the sales consultant", () => {
  it("drafts a follow-up for a quote read repeatedly — and sends nothing", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Reader Co", role: "CUSTOMER" } });
    await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "QUOTE", status: "SENT", amountCents: 40_000_00, openCount: 4, lastOpenedAt: new Date(), createdAt: new Date(Date.now() - 6 * DAY) } });
    const r = await runSales(tenantId);
    expect(r.observed).toBe(1);
    const [draft] = await prisma.aiDraft.findMany({ where: { tenantId } });
    expect(draft.status).toBe("PENDING");
    expect((await listOpen(tenantId))[0].proposedAction).toContain("drafted");
  });

  it("notices a customer whose ordering rhythm has broken", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Regular Co", role: "CUSTOMER" } });
    for (const d of [140, 110, 80]) {
      await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "INVOICE", status: "PAID", amountCents: 5_000_00, createdAt: new Date(Date.now() - d * DAY) } });
    }
    await runSales(tenantId);
    expect((await listOpen(tenantId)).some((o) => o.dedupeKey === `sales:quiet:${p.id}`)).toBe(true);
  });
});

describe("the legal consultant", () => {
  it("raises an auto-renewing contract inside its notice window, and staff with no contract", async () => {
    await prisma.obligation.create({ data: { tenantId, kind: "CONTRACT", title: "Tracking contract", dueAt: new Date(Date.now() + 40 * DAY), noticeDays: 30, autoRenews: true, amountCents: 900_00, recurrence: "MONTHLY" } });
    const u = await prisma.user.create({ data: { email: `staff-${tenantId}@test.local`, name: "New Hire" } });
    await prisma.membership.create({ data: { tenantId, userId: u.id, role: "STAFF", createdAt: new Date(Date.now() - 30 * DAY) } });
    const r = await runLegal(tenantId);
    expect(r.failed).toEqual([]);
    const keys = (await listOpen(tenantId)).map((o) => o.dedupeKey);
    expect(keys.some((k) => k.startsWith("legal:notice:"))).toBe(true);
    expect(keys).toContain("legal:no-contracts");
    await prisma.membership.deleteMany({ where: { tenantId, userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  });
});

describe("shared memory and handoffs", () => {
  it("halves another officer's confidence on a subject the owner just set aside, and says why", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Subject Co", role: "CUSTOMER" } });
    const first = await observe({ tenantId, officer: "SALES", headline: "Quiet.", dedupeKey: "sales:quiet:x", subjectType: "customer", subjectId: p.id, confidence: 80 });
    await decide({ tenantId, observationId: first!.id, actioned: false, note: "They are seasonal" });

    const second = await observe({ tenantId, officer: "CEO", headline: "Loss-making.", dedupeKey: "ceo:customer-loss:x", subjectType: "customer", subjectId: p.id, confidence: 80 });
    expect(second!.confidence).toBe(40);
    expect(second!.detail).toContain("They are seasonal");

    const memory = await sharedMemory(tenantId);
    expect(memory[0].outcome).toBe("set aside");
  });
});

describe("industry packs and turnaround", () => {
  it("lifts a trade's findings and, in turnaround, puts cash first", () => {
    expect(weightFor("coo:empty-running", { niche: "LOGISTICS", turnaround: false })).toBeGreaterThan(1);
    expect(weightFor("coo:empty-running", { niche: "RETAIL", turnaround: false })).toBe(1);
    expect(weightFor("cfo:cash-gap", { niche: "SERVICES", turnaround: true })).toBeGreaterThan(2);
    expect(weightFor("ceo:concentration:x", { niche: "SERVICES", turnaround: true })).toBeLessThan(1);
  });

  it("reorders the Brief when turnaround mode is switched on", async () => {
    await observe({ tenantId, officer: "CEO", headline: "Growth idea.", dedupeKey: "ceo:concentration:a", moneyCents: 100_000_00, confidence: 75 });
    await observe({ tenantId, officer: "CFO", headline: "Cash runs out.", dedupeKey: "cfo:cash-gap", moneyCents: 30_000_00, confidence: 75 });
    expect((await currentBrief(tenantId)).items[0].headline).toBe("Growth idea.");
    await prisma.tenant.update({ where: { id: tenantId }, data: { turnaroundMode: true } });
    expect((await currentBrief(tenantId)).items[0].headline).toBe("Cash runs out.");
  });
});
