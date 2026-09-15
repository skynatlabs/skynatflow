// Costing.
//
// The figures here are the product's claim to exist, so the tests assert
// arithmetic, not shape: that a vehicle's cost per kilometre is built from
// every kind of cost on it and divided by kilometres that actually happened,
// and that a job's margin takes off the goods, the tagged costs and its share
// of the trip that delivered it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { ensureChartOfAccounts } from "../../src/lib/core/ledger";
import { submitExpense } from "../../src/lib/core/expenses";
import { startTrip, endTrip } from "../../src/lib/core/trips";
import {
  assetCosts,
  costRates,
  customerMargins,
  fleetCost,
  jobMargins,
  laneMargins,
  lastDays,
} from "../../src/lib/core/costing";

let tenantId: string;
let assetId: string;
let driverId: string;
let ownerId: string;
let userIds: string[] = [];
let customerId: string;
let itemId: string;

const DAY = 86_400_000;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Cost Co", niche: "LOGISTICS" } });
  tenantId = t.id;
  await ensureChartOfAccounts(tenantId);
  const a = await prisma.asset.create({
    data: {
      tenantId, name: "Truck", capacityUnit: "KM",
      purchaseCents: 240_000_00, usefulLifeMonths: 48, purchasedOn: new Date(Date.now() - 365 * DAY),
    },
  });
  assetId = a.id;
  const u1 = await prisma.user.create({ data: { email: `cost-d-${t.id}@test.local`, name: "Driver" } });
  const u2 = await prisma.user.create({ data: { email: `cost-o-${t.id}@test.local`, name: "Owner" } });
  userIds = [u1.id, u2.id];
  driverId = (await prisma.membership.create({ data: { tenantId, userId: u1.id, role: "DRIVER", costRateCents: 150_00 } })).id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId: u2.id, role: "OWNER" } })).id;
  customerId = (await prisma.party.create({ data: { tenantId, name: "Big Client", role: "CUSTOMER" } })).id;
  itemId = (await prisma.item.create({ data: { tenantId, name: "Widget", unitPriceCents: 1_000_00, costCents: 400_00, taxRatePercent: 15 } })).id;
  await prisma.obligation.create({
    data: { tenantId, kind: "INSURANCE", title: "Truck cover", dueAt: new Date(Date.now() + 200 * DAY), recurrence: "ANNUAL", amountCents: 12_000_00, assetId },
  });
});

afterEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

/** Two done runs on the truck: 400 km in 4 h, then 200 km in 2 h, both this week. */
async function twoRuns() {
  // One clock reading: two Date.now() calls a millisecond apart make "four
  // hours" 4.0000003, which rounds a rand the wrong way.
  const now = Date.now();
  const t1 = await startTrip({ tenantId, assetId, driverId, originText: "JHB", destinationText: "DBN", odometerStartKm: 1000, startedAt: new Date(now - 5 * DAY) });
  await endTrip(tenantId, t1.id, { odometerEndKm: 1400, at: new Date(now - 5 * DAY + 4 * 3_600_000) });
  const t2 = await startTrip({ tenantId, assetId, driverId, originText: "JHB", destinationText: "DBN", odometerStartKm: 1400, startedAt: new Date(now - 2 * DAY) });
  await endTrip(tenantId, t2.id, { odometerEndKm: 1600, at: new Date(now - 2 * DAY + 2 * 3_600_000) });
  return [t1.id, t2.id];
}

describe("cost per unit of capacity", () => {
  it("builds a vehicle's cost per kilometre from every kind of cost on it", async () => {
    await twoRuns();
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 1_200_00, assetId, odometerKm: 1050, isOwnerDrawing: false });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 600_00, assetId, odometerKm: 1450, isOwnerDrawing: false });

    const [truck] = await assetCosts(tenantId, lastDays(30));

    expect(truck.directCents).toBe(1_800_00);
    // 6 hours of a R150/h driver.
    expect(truck.labourCents).toBe(900_00);
    // R12 000 a year of cover, thirty days of it.
    expect(truck.obligationCents).toBeGreaterThan(950_00);
    expect(truck.obligationCents).toBeLessThan(1_000_00);
    // R240 000 over 48 months, one month of it.
    expect(truck.depreciationCents).toBeGreaterThan(4_800_00);
    expect(truck.depreciationCents).toBeLessThan(5_100_00);
    // The odometer went from 1000 to 1600.
    expect(truck.units).toBe(600);
    expect(truck.unitsSource).toBe("ODOMETER");
    expect(truck.costPerUnitCents).toBe(Math.round(truck.totalCents / 600));
    expect(truck.confidence).toBe("MEDIUM");
  });

  it("produces no per-unit figure for an asset nobody has given a unit", async () => {
    const drill = await prisma.asset.create({ data: { tenantId, name: "Drill" } });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Bits", amountCents: 300_00, assetId: drill.id, isOwnerDrawing: false });
    const costs = await assetCosts(tenantId, lastDays(30));
    const d = costs.find((c) => c.assetId === drill.id)!;
    expect(d.directCents).toBe(300_00);
    expect(d.costPerUnitCents).toBeNull();
    expect(d.confidence).toBe("LOW");
  });

  it("counts kilometres from trips when the odometer was never read", async () => {
    const t = await startTrip({ tenantId, assetId, driverId, startedAt: new Date(Date.now() - DAY) });
    await endTrip(tenantId, t.id, { distanceKm: 120, at: new Date() });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 500_00, assetId, isOwnerDrawing: false });
    const [truck] = await assetCosts(tenantId, lastDays(30));
    expect(truck.units).toBe(120);
    expect(truck.unitsSource).toBe("TRIPS");
  });
});

describe("margin", () => {
  async function invoice(amountNet: number, qty = 2) {
    // qty × R1 000 + 15% tax; amountCents holds the gross.
    const gross = Math.round(amountNet * 1.15);
    const inv = await prisma.transaction.create({
      data: { tenantId, partyId: customerId, type: "INVOICE", status: "SENT", amountCents: gross },
    });
    await prisma.transactionLine.create({
      data: { transactionId: inv.id, itemId, quantity: qty, unitPriceCents: amountNet / qty, taxRatePercent: 15 },
    });
    return inv;
  }

  it("takes goods, tagged costs and the trip's share off an invoice", async () => {
    const [t1] = await twoRuns();
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 1_200_00, assetId, isOwnerDrawing: false });
    const inv = await invoice(2_000_00);
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Site consumables", amountCents: 100_00, transactionId: inv.id, isOwnerDrawing: false });
    // Two stops on the first run; this invoice is one of them.
    await prisma.tripStop.createMany({
      data: [
        { tripId: t1, tenantId, sequence: 0, transactionId: inv.id, partyId: customerId },
        { tripId: t1, tenantId, sequence: 1, label: "Somewhere else" },
      ],
    });

    const period = lastDays(90);
    const rates = await costRates(tenantId, period);
    const perKm = rates.perKmByAsset.get(assetId)!;
    const [job] = await jobMargins(tenantId, period);

    expect(job.revenueCents).toBe(2_000_00);
    expect(job.cogsCents).toBe(800_00);
    expect(job.directCents).toBe(100_00);
    expect(job.travelCents).toBe(Math.round(Math.round(400 * perKm) / 2));
    expect(job.travelPriced).toBe(true);
    expect(job.marginCents).toBe(2_000_00 - 800_00 - 100_00 - job.travelCents);
  });

  it("flags a customer whose travel could not be priced rather than pricing it at nothing", async () => {
    const inv = await invoice(2_000_00);
    const t = await startTrip({ tenantId, assetId: null, driverId, startedAt: new Date(Date.now() - DAY) });
    await endTrip(tenantId, t.id, { at: new Date() }); // no distance
    await prisma.tripStop.create({ data: { tripId: t.id, tenantId, sequence: 0, transactionId: inv.id, partyId: customerId } });

    const [c] = await customerMargins(tenantId, lastDays(90));
    expect(c.partyName).toBe("Big Client");
    expect(c.travelPriced).toBe(false);
    expect(c.travelPriced).toBe(false);
  });

  it("reports a lane's margin across every run down it", async () => {
    const [t1, t2] = await twoRuns();
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 3_000_00, assetId, isOwnerDrawing: false });
    const a = await invoice(5_000_00);
    const b = await invoice(4_000_00);
    await prisma.tripStop.createMany({
      data: [
        { tripId: t1, tenantId, sequence: 0, transactionId: a.id, partyId: customerId },
        { tripId: t2, tenantId, sequence: 0, transactionId: b.id, partyId: customerId },
      ],
    });
    const [lane] = await laneMargins(tenantId, lastDays(90));
    expect(lane.laneKey).toBe("jhb > dbn");
    expect(lane.trips).toBe(2);
    expect(lane.km).toBe(600);
    expect(lane.revenueCents).toBe(9_000_00);
    expect(lane.priced).toBe(true);
    expect(lane.marginCents).toBe(9_000_00 - lane.costCents);
  });

  it("says what the fleet costs as a share of what was invoiced", async () => {
    await twoRuns();
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 3_000_00, assetId, isOwnerDrawing: false });
    await invoice(20_000_00, 20);
    const f = await fleetCost(tenantId, lastDays(30));
    expect(f.vehicles).toBe(1);
    expect(f.km).toBe(600);
    expect(f.revenueCents).toBe(20_000_00);
    expect(f.percentOfRevenue).toBe(Math.round((f.totalCents / 20_000_00) * 100));
  });
});
