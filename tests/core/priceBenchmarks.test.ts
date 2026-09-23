// The privacy rules are the point, so they are what the tests defend: a
// workspace that has not opted in sees nothing and contributes nothing, a
// cohort under the floor is reported as "not enough data" rather than
// quietly vanishing, and a business is never compared against itself.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  productKey,
  priceBenchmarks,
  supplierSpread,
  PRICE_COHORT_FLOOR,
} from "../../src/lib/core/priceBenchmarks";

let mine: string;
const others: string[] = [];

async function makeTenant(name: string, optedIn: boolean) {
  const tenant = await prisma.tenant.create({
    data: { name, niche: "RETAIL", benchmarksOptedIn: optedIn },
  });
  return tenant.id;
}

async function buy(params: {
  tenantId: string;
  itemName: string;
  unitCostCents: number;
  quantity?: number;
  supplierName?: string;
  daysAgo?: number;
}) {
  const item = await prisma.item.create({
    data: { tenantId: params.tenantId, name: params.itemName, unitPriceCents: 0 },
  });
  const supplier = await prisma.party.create({
    data: {
      tenantId: params.tenantId,
      role: PartyRole.SUPPLIER,
      name: params.supplierName ?? "A Supplier",
    },
  });
  await prisma.purchaseOrder.create({
    data: {
      tenantId: params.tenantId,
      supplierId: supplier.id,
      totalCostCents: params.unitCostCents * (params.quantity ?? 1),
      createdAt: new Date(Date.now() - (params.daysAgo ?? 10) * 86_400_000),
      lines: {
        create: [
          { itemId: item.id, quantity: params.quantity ?? 1, unitCostCents: params.unitCostCents },
        ],
      },
    },
  });
}

async function wipe(tenantId: string) {
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
}

beforeAll(async () => {
  mine = await makeTenant("Price Bench Mine", true);
  for (let i = 0; i < 8; i++) others.push(await makeTenant(`Price Bench Peer ${i}`, true));
});

afterAll(async () => {
  for (const id of [mine, ...others]) {
    await wipe(id);
    await prisma.tenant.delete({ where: { id } });
  }
});

beforeEach(async () => {
  for (const id of [mine, ...others]) await wipe(id);
  await prisma.tenant.update({ where: { id: mine }, data: { benchmarksOptedIn: true } });
});

describe("matching products by name", () => {
  it("ignores word order and punctuation", () => {
    expect(productKey("Cement 50kg PPC")).toBe(productKey("PPC, cement 50KG"));
  });

  it("keeps the size, because it is usually the difference", () => {
    expect(productKey("Cement 50kg")).not.toBe(productKey("Cement 25kg"));
  });
});

describe("the opt-in", () => {
  it("shows nothing at all to a workspace that has not opted in", async () => {
    await prisma.tenant.update({ where: { id: mine }, data: { benchmarksOptedIn: false } });
    const result = await priceBenchmarks(mine);
    expect(result.optedIn).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.summary).toMatch(/nothing of yours is shared/i);
  });

  it("leaves a workspace that has not opted in out of everybody else's cohort", async () => {
    const hidden = await makeTenant("Secretive Co", false);
    await buy({ tenantId: mine, itemName: "Portland cement 50kg", unitCostCents: 12000 });
    for (const id of others) {
      await buy({ tenantId: id, itemName: "Portland cement 50kg", unitCostCents: 10000 });
    }
    await buy({ tenantId: hidden, itemName: "Portland cement 50kg", unitCostCents: 99900 });

    const result = await priceBenchmarks(mine);
    const cement = result.rows.find((r) => r.name.includes("cement"));
    // Eight peers contributed; the secretive one did not move the median.
    expect(cement?.cohort).toBe(8);
    expect(cement?.medianCents).toBe(10000);

    await wipe(hidden);
    await prisma.tenant.delete({ where: { id: hidden } });
  });
});

describe("the floor", () => {
  it("says there is not enough data rather than quietly dropping a line", async () => {
    await buy({ tenantId: mine, itemName: "Rare widget 900mm", unitCostCents: 5000 });
    for (const id of others.slice(0, PRICE_COHORT_FLOOR - 1)) {
      await buy({ tenantId: id, itemName: "Rare widget 900mm", unitCostCents: 4000 });
    }

    const result = await priceBenchmarks(mine);
    expect(result.rows).toHaveLength(0);
    expect(result.notEnoughData).toContain("Rare widget 900mm");
  });

  it("reports once the floor is reached", async () => {
    await buy({ tenantId: mine, itemName: "Common widget 900mm", unitCostCents: 5000 });
    for (const id of others.slice(0, PRICE_COHORT_FLOOR)) {
      await buy({ tenantId: id, itemName: "Common widget 900mm", unitCostCents: 4000 });
    }
    const result = await priceBenchmarks(mine);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cohort).toBe(PRICE_COHORT_FLOOR);
  });
});

describe("the comparison", () => {
  beforeEach(async () => {
    // Eight peers paying between R95 and R110; this business pays R130.
    const peerPrices = [9500, 9800, 10000, 10200, 10500, 10800, 11000, 11000];
    for (let i = 0; i < others.length; i++) {
      await buy({ tenantId: others[i], itemName: "Tyre 195 65 R15", unitCostCents: peerPrices[i] });
    }
    await buy({
      tenantId: mine,
      itemName: "Tyre 195 65 R15",
      unitCostCents: 13000,
      quantity: 20,
      daysAgo: 30,
    });
  });

  it("puts this business against the middle of everybody else", async () => {
    const result = await priceBenchmarks(mine, { sinceDays: 180 });
    const tyre = result.rows[0];
    expect(tyre.yoursCents).toBe(13000);
    expect(tyre.medianCents).toBe(10350);
    expect(tyre.differenceCents).toBe(2650);
    expect(tyre.differencePercent).toBeGreaterThan(25);
  });

  it("annualises the saving at the rate this business actually buys", async () => {
    const result = await priceBenchmarks(mine, { sinceDays: 180 });
    // 20 units in 180 days is about 40 a year, at R26.50 over the median.
    expect(result.rows[0].couldSaveCentsPerYear).toBeGreaterThan(100000);
    expect(result.totalCouldSaveCentsPerYear).toBe(result.rows[0].couldSaveCentsPerYear);
  });

  it("does not count a business's own purchases towards its cohort", async () => {
    // Buy the same thing nine more times; the cohort must not grow.
    for (let i = 0; i < 9; i++) {
      await buy({ tenantId: mine, itemName: "Tyre 195 65 R15", unitCostCents: 13000 });
    }
    const result = await priceBenchmarks(mine, { sinceDays: 180 });
    expect(result.rows[0].cohort).toBe(8);
  });

  it("claims no saving when already below the middle", async () => {
    await wipe(mine);
    await prisma.tenant.update({ where: { id: mine }, data: { benchmarksOptedIn: true } });
    await buy({ tenantId: mine, itemName: "Tyre 195 65 R15", unitCostCents: 9000, quantity: 10 });

    const result = await priceBenchmarks(mine, { sinceDays: 180 });
    expect(result.rows[0].differenceCents).toBeLessThan(0);
    expect(result.rows[0].couldSaveCentsPerYear).toBe(0);
    expect(result.summary).toMatch(/at or below the middle/i);
  });

  it("uses the most recent price, not the oldest", async () => {
    await buy({ tenantId: mine, itemName: "Tyre 195 65 R15", unitCostCents: 9900, daysAgo: 1 });
    const result = await priceBenchmarks(mine, { sinceDays: 180 });
    expect(result.rows[0].yoursCents).toBe(9900);
  });
});

describe("the same thing from different suppliers", () => {
  it("needs no cohort, because every number already belongs to this business", async () => {
    await buy({
      tenantId: mine,
      itemName: "Cement 50kg",
      unitCostCents: 9000,
      supplierName: "Cheap Merchants",
    });
    await buy({
      tenantId: mine,
      itemName: "Cement 50kg",
      unitCostCents: 12000,
      supplierName: "Expensive Merchants",
    });

    const spread = await supplierSpread(mine);
    expect(spread).toHaveLength(1);
    expect(spread[0].bestCents).toBe(9000);
    expect(spread[0].worstCents).toBe(12000);
    expect(spread[0].spreadPercent).toBeCloseTo(33.3, 0);
    expect(spread[0].suppliers[0].supplierName).toBe("Cheap Merchants");
  });

  it("says nothing about a line bought from only one supplier", async () => {
    await buy({ tenantId: mine, itemName: "Cement 50kg", unitCostCents: 9000 });
    expect(await supplierSpread(mine)).toHaveLength(0);
  });

  it("says nothing when both suppliers charge the same", async () => {
    await buy({ tenantId: mine, itemName: "Cement 50kg", unitCostCents: 9000, supplierName: "A" });
    await buy({ tenantId: mine, itemName: "Cement 50kg", unitCostCents: 9000, supplierName: "B" });
    expect(await supplierSpread(mine)).toHaveLength(0);
  });
});
