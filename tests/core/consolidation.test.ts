// The consolidation engine.
//
// Each source is tested for the one thing it must get right: that it finds
// the pattern when it is there, puts a defensible figure on it, and stays
// quiet when the figure would be a rounding error. The assumptions the
// engine makes are asserted to be named in the evidence, because a saving
// resting on an unnamed assumption is a number nobody can check.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { submitExpense } from "../../src/lib/core/expenses";
import { startTrip, endTrip } from "../../src/lib/core/trips";
import {
  supplierConsolidation,
  tripConsolidation,
  recurringSpend,
  subscriptionOverlaps,
  purchaseTiming,
  insuranceConsolidation,
  consolidationReport,
} from "../../src/lib/core/consolidation";
import { lastDays } from "../../src/lib/core/costing";

let tenantId: string;
let ownerId: string;
let userId: string;
const DAY = 86_400_000;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Consolidate Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `cons-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
});

afterEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe("suppliers", () => {
  it("prices the same goods from two suppliers against the cheaper one", async () => {
    const a = await prisma.party.create({ data: { tenantId, name: "Cheap Fuel", role: "SUPPLIER" } });
    const b = await prisma.party.create({ data: { tenantId, name: "Dear Fuel", role: "SUPPLIER" } });
    await submitExpense({
      tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 2_200_00, supplierId: a.id, spentOn: daysAgo(10),
      lines: [{ description: "Diesel 50ppm", quantity: 100, unit: "L", unitCents: 22_00 }],
    });
    await submitExpense({
      tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 2_400_00, supplierId: b.id, spentOn: daysAgo(20),
      lines: [{ description: "Diesel 50ppm", quantity: 100, unit: "L", unitCents: 24_00 }],
    });

    const [s] = await supplierConsolidation(tenantId, lastDays(90));
    expect(s).toBeTruthy();
    expect(s.kind).toBe("SUPPLIER");
    expect(s.headline).toContain("2 suppliers");
    // R2 a litre on 100 litres over 90 days, annualised.
    expect(s.annualCents).toBe(Math.round(200_00 * (365 / 90)));
    expect(s.evidence.find((e) => e.label === "Best supplier")?.value).toContain("Cheap Fuel");
    expect(s.evidence.find((e) => e.label === "Best unit cents")?.value).toBe("2200");
    expect(s.effort).toBe("PHONE_CALL");
  });

  it("says nothing about a price spread too small to matter", async () => {
    const a = await prisma.party.create({ data: { tenantId, name: "A", role: "SUPPLIER" } });
    const b = await prisma.party.create({ data: { tenantId, name: "B", role: "SUPPLIER" } });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Bolts", amountCents: 20_00, supplierId: a.id, lines: [{ description: "M8 bolt", quantity: 2, unitCents: 10_00 }] });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Bolts", amountCents: 22_00, supplierId: b.id, lines: [{ description: "M8 bolt", quantity: 2, unitCents: 11_00 }] });
    expect(await supplierConsolidation(tenantId, lastDays(90))).toEqual([]);
  });
});

describe("trips", () => {
  it("notices the same suburb driven to twice a week, week after week", async () => {
    const asset = await prisma.asset.create({ data: { tenantId, name: "Van", capacityUnit: "KM" } });
    const party = await prisma.party.create({ data: { tenantId, name: "Sandton Client", role: "CUSTOMER", city: "Sandton" } });
    // A cost on the van so its runs can be priced.
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 4_000_00, assetId: asset.id, isOwnerDrawing: false, spentOn: daysAgo(3) });

    // Two runs in each of two different weeks, three weeks apart.
    let odo = 1000;
    for (const weekStart of [daysAgo(28), daysAgo(7)]) {
      for (const hour of [9, 14]) {
        const at = new Date(weekStart.getTime() + hour * 3_600_000);
        const t = await startTrip({ tenantId, assetId: asset.id, odometerStartKm: odo, startedAt: at, stops: [{ partyId: party.id }] });
        odo += 40;
        await endTrip(tenantId, t.id, { odometerEndKm: odo, at: new Date(at.getTime() + 3_600_000) });
      }
    }

    const [s] = await tripConsolidation(tenantId, lastDays(90));
    expect(s).toBeTruthy();
    expect(s.kind).toBe("TRIPS");
    expect(s.headline).toContain("Sandton");
    expect(s.annualCents).toBeGreaterThan(0);
    expect(s.evidence.find((e) => e.label === "Weeks")?.value).toMatch(/2 runs.*2 runs/);
    expect(s.evidence.find((e) => e.label === "Assumption")?.value).toContain("50%");
  });
});

describe("recurring spend", () => {
  it("lists what recurs and finds two subscriptions doing one job", async () => {
    for (let m = 1; m <= 4; m++) {
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Streaming", amountCents: 199_00, supplierName: "Netflix", category: "Streaming", spentOn: daysAgo(30 * m), isOwnerDrawing: false });
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Streaming", amountCents: 99_00, supplierName: "Showmax", category: "Streaming", spentOn: daysAgo(30 * m + 2), isOwnerDrawing: false });
    }
    const items = await recurringSpend(tenantId);
    expect(items.map((i) => i.label).sort()).toEqual(["Netflix", "Showmax"]);
    expect(items.every((i) => i.cadence === "MONTHLY")).toBe(true);
    expect(items.find((i) => i.label === "Netflix")?.annualCents).toBe(199_00 * 12);

    const [overlap] = await subscriptionOverlaps(tenantId);
    expect(overlap.kind).toBe("SUBSCRIPTION");
    expect(overlap.annualCents).toBe(99_00 * 12);
    expect(overlap.evidence.find((e) => e.label === "Match key")?.value).toBe("Showmax");
  });

  it("ignores a payment that happens to repeat at no particular rhythm", async () => {
    for (const d of [3, 9, 40, 41]) {
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Parts", amountCents: 500_00, supplierName: "Parts Shop", spentOn: daysAgo(d) });
    }
    expect(await recurringSpend(tenantId)).toEqual([]);
  });
});

describe("purchase timing", () => {
  it("proposes a monthly order for frequent small buys and names the assumed discount", async () => {
    for (let i = 0; i < 9; i++) {
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Bits and bobs", amountCents: 300_00, supplierName: "Builders", spentOn: daysAgo(i * 9 + 1), isOwnerDrawing: false });
    }
    const [s] = await purchaseTiming(tenantId);
    expect(s.kind).toBe("TIMING");
    expect(s.headline).toContain("Builders");
    expect(s.annualCents).toBe(Math.round((2_700_00 / 3) * 12 * 0.08));
    expect(s.evidence.find((e) => e.label === "Assumption")?.value).toContain("8%");
    // No bank feed: the cash check is declared unchecked, not assumed fine.
    expect(s.detail).toContain("unchecked");
    expect(s.confidence).toBeLessThan(40);
  });
});

describe("insurance", () => {
  it("adds up scattered policies and quotes one book as an assumption", async () => {
    for (const [title, insurer] of [["Van cover", "Santam"], ["Bakkie cover", "Santam"], ["Premises", "Hollard"]] as const) {
      await prisma.obligation.create({ data: { tenantId, kind: "INSURANCE", title, authority: insurer, dueAt: daysAgo(-100), recurrence: "ANNUAL", amountCents: 10_000_00 } });
    }
    const [s] = await insuranceConsolidation(tenantId);
    expect(s.kind).toBe("INSURANCE");
    expect(s.headline).toContain("3 insurance policies with 2 insurers");
    expect(s.annualCents).toBe(3_000_00);
    expect(s.evidence.find((e) => e.label === "Assumption")?.value).toContain("10%");
  });

  it("says nothing about a single policy", async () => {
    await prisma.obligation.create({ data: { tenantId, kind: "INSURANCE", title: "Only cover", authority: "Santam", dueAt: daysAgo(-100), recurrence: "ANNUAL", amountCents: 50_000_00 } });
    expect(await insuranceConsolidation(tenantId)).toEqual([]);
  });
});

describe("the report", () => {
  it("ranks by money weighted by confidence and reports nothing failed", async () => {
    for (const [title, insurer] of [["A", "X"], ["B", "Y"]] as const) {
      await prisma.obligation.create({ data: { tenantId, kind: "INSURANCE", title, authority: insurer, dueAt: daysAgo(-100), recurrence: "ANNUAL", amountCents: 40_000_00 } });
    }
    const r = await consolidationReport(tenantId);
    expect(r.failed).toEqual([]);
    expect(r.savings.length).toBeGreaterThanOrEqual(1);
    expect(r.weightedAnnualCents).toBeLessThan(r.totalAnnualCents);
    for (let i = 1; i < r.savings.length; i++) {
      const a = r.savings[i - 1];
      const b = r.savings[i];
      expect(a.annualCents * a.confidence).toBeGreaterThanOrEqual(b.annualCents * b.confidence);
    }
  });

  it("is empty for an empty workspace", async () => {
    const r = await consolidationReport(tenantId);
    expect(r.savings).toEqual([]);
    expect(r.recurring).toEqual([]);
  });
});
