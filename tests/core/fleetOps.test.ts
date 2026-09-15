// The logistics arc. Each finding is tested for the arithmetic that makes it
// defensible and the refusal that keeps it honest.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { submitExpense } from "../../src/lib/core/expenses";
import { startTrip, endTrip, addStop, arriveAtStop, departStop } from "../../src/lib/core/trips";
import {
  detentionOwed, billDetention, unbilledRecoverables, billRecoverables,
  emptyRunning, fuelConsumption, maintenanceDue, consumablesByAsset,
  checkLoad, assertSubcontractorClear, subcontractorsAtRisk,
  reportIncident, addToIncident, incidentPack, routeDeviations,
} from "../../src/lib/core/fleetOps";
import { WorkBlockedError } from "../../src/lib/core/obligations";

let tenantId: string;
let ownerId: string;
let userId: string;
let truckId: string;
let customerId: string;
const DAY = 86_400_000;
const H = 3_600_000;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Fleet Co", niche: "LOGISTICS", detentionFreeMinutes: 60, detentionRateCents: 400_00 } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `fleet-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
  truckId = (await prisma.asset.create({ data: { tenantId, name: "Truck", capacityUnit: "KM", tareKg: 8_000, maxGrossKg: 16_000, serviceIntervalKm: 15_000, lastServiceKm: 100_000 } })).id;
  customerId = (await prisma.party.create({ data: { tenantId, name: "Gate Co", role: "CUSTOMER" } })).id;
});

afterEach(async () => {
  await prisma.incident.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.obligation.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("143 detention", () => {
  it("bills time beyond the free hour per started half hour, once", async () => {
    const trip = await startTrip({ tenantId, assetId: truckId });
    const stop = await addStop(tenantId, trip.id, { partyId: customerId });
    const t0 = Date.now() - 5 * H;
    await arriveAtStop(tenantId, stop.id, new Date(t0));
    await departStop(tenantId, stop.id, { at: new Date(t0 + 2 * H + 10 * 60_000) }); // 130 min: 70 billable

    const [line] = await detentionOwed(tenantId);
    expect(line.billableMinutes).toBe(70);
    expect(line.cents).toBe(3 * 200_00); // three started half hours at R200

    const inv = await billDetention(tenantId, stop.id);
    expect(inv.status).toBe("DRAFT");
    expect(inv.amountCents).toBe(600_00);
    await expect(billDetention(tenantId, stop.id)).rejects.toThrow(/Already billed/);
  });
});

describe("144 recoverable costs", () => {
  it("gathers a customer's tolls onto one draft invoice and marks them billed", async () => {
    const quote = await prisma.transaction.create({ data: { tenantId, partyId: customerId, type: "INVOICE", status: "SENT", amountCents: 10_000_00 } });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "N3 toll", amountCents: 186_00, transactionId: quote.id, recoverable: true });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Abnormal load permit", amountCents: 950_00, transactionId: quote.id, recoverable: true });
    expect(await unbilledRecoverables(tenantId)).toHaveLength(2);
    const r = await billRecoverables(tenantId, customerId);
    expect(r.totalCents).toBe(1_136_00);
    expect(await unbilledRecoverables(tenantId)).toHaveLength(0);
  });
});

describe("145 empty running", () => {
  it("names a run that ended away from base with no loaded run back", async () => {
    for (const d of [20, 12]) {
      const t = await startTrip({ tenantId, assetId: truckId, originText: "Depot JHB", destinationText: "Durban", startedAt: new Date(Date.now() - d * DAY) });
      await endTrip(tenantId, t.id, { at: new Date(Date.now() - d * DAY + 8 * H), distanceKm: 570 });
      const back = await startTrip({ tenantId, assetId: truckId, originText: "Durban", destinationText: "Depot JHB", startedAt: new Date(Date.now() - d * DAY + 20 * H) });
      await endTrip(tenantId, back.id, { at: new Date(Date.now() - d * DAY + 28 * H), distanceKm: 570 });
    }
    const legs = await emptyRunning(tenantId);
    expect(legs.filter((l) => l.destination === "Durban")).toHaveLength(2);
  });
});

describe("146 fuel per 100 km", () => {
  it("flags a sustained change against the vehicle's own history, not one tank", async () => {
    let odo = 100_000;
    for (let i = 0; i < 10; i++) {
      const km = 400;
      odo += km;
      const litres = i < 5 ? 120 : 150; // 30 L/100 km then 37.5
      await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: litres * 22_00, assetId: truckId, quantity: litres, unit: "L", odometerKm: odo, spentOn: new Date(Date.now() - (10 - i) * DAY) });
    }
    const [row] = await fuelConsumption(tenantId);
    expect(row.fills).toBe(10);
    expect(row.deviationPercent).toBeGreaterThanOrEqual(15);
  });
});

describe("147 maintenance and 148 consumables", () => {
  it("puts a service due from the odometer, and tyres as a cost per km", async () => {
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "4x drive tyres", amountCents: 24_000_00, assetId: truckId, odometerKm: 100_500 });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 3_000_00, assetId: truckId, odometerKm: 114_500 });
    const [due] = await maintenanceDue(tenantId);
    expect(due.dueAtKm).toBe(115_000);
    expect(due.kmRemaining).toBe(500);
    const [tyres] = await consumablesByAsset(tenantId);
    expect(tyres.kind).toBe("tyre");
    expect(tyres.kmCovered).toBe(14_000);
  });
});

describe("149 load planning", () => {
  it("walks the stops and catches a peak over the permissible gross", async () => {
    const trip = await startTrip({ tenantId, assetId: truckId, planOnly: true });
    const a = await addStop(tenantId, trip.id, { label: "Pick up" });
    const b = await addStop(tenantId, trip.id, { label: "Pick up more" });
    const c = await addStop(tenantId, trip.id, { label: "Drop all" });
    await prisma.tripStop.update({ where: { id: a.id }, data: { loadKg: 5_000 } });
    await prisma.tripStop.update({ where: { id: b.id }, data: { loadKg: 4_000 } });
    await prisma.tripStop.update({ where: { id: c.id }, data: { loadKg: -9_000 } });
    const check = await checkLoad(tenantId, trip.id);
    // Picked up and dropped on the same run: nothing on board at the start,
    // a peak of 9 000 kg, which on an 8 000 kg truck is 1 000 over.
    expect(check!.peakPayloadKg).toBe(9_000);
    expect(check!.peakGrossKg).toBe(17_000);
    expect(check!.overKg).toBe(1_000);
    expect(check!.ok).toBe(false);
  });

  it("counts a drop before any pickup as on board leaving the depot", async () => {
    const trip = await startTrip({ tenantId, assetId: truckId, planOnly: true });
    const a = await addStop(tenantId, trip.id, { label: "Drop" });
    const b = await addStop(tenantId, trip.id, { label: "Collect" });
    await prisma.tripStop.update({ where: { id: a.id }, data: { loadKg: -6_000 } });
    await prisma.tripStop.update({ where: { id: b.id }, data: { loadKg: 2_000 } });
    const check = await checkLoad(tenantId, trip.id);
    expect(check!.peakPayloadKg).toBe(6_000);
    expect(check!.ok).toBe(true);
  });
});

describe("150 subcontractor gate", () => {
  it("refuses a run for an owner-driver whose cover has lapsed", async () => {
    const sub = await prisma.party.create({ data: { tenantId, name: "Owner Driver", role: "SUBCONTRACTOR" } });
    await prisma.obligation.create({ data: { tenantId, kind: "INSURANCE", title: "Goods in transit cover", dueAt: new Date(Date.now() - 5 * DAY), blocksWork: true, partyId: sub.id } });
    await expect(assertSubcontractorClear(tenantId, sub.id)).rejects.toBeInstanceOf(WorkBlockedError);
    await expect(startTrip({ tenantId, subcontractorId: sub.id })).rejects.toBeInstanceOf(WorkBlockedError);
    // Planning ahead is allowed; the refusal is at the moment work would start.
    await expect(startTrip({ tenantId, subcontractorId: sub.id, planOnly: true })).resolves.toBeTruthy();
    const risky = await subcontractorsAtRisk(tenantId);
    expect(risky[0].name).toBe("Owner Driver");
  });
});

describe("151 incidents", () => {
  it("says what the insurer still needs, and stops saying it once it is there", async () => {
    const inc = await reportIncident({ tenantId, description: "Rear-ended at a robot.", assetId: truckId });
    expect(inc.missing.length).toBeGreaterThanOrEqual(3);
    const after = await addToIncident(tenantId, inc.id, {
      otherParty: "J Smith, CA 999-111, insured with Outsurance",
      description: "Stationary at a red robot on Main Rd when a white Polo failed to stop and hit the rear bumper.",
      lat: -26.1, lng: 28.0, photos: ["data:image/png;base64,a", "data:image/png;base64,b", "data:image/png;base64,c"],
    });
    expect(after.missing).toEqual([]);
    const pack = await incidentPack(tenantId, inc.id);
    expect(pack.complete).toBe(true);
    expect(pack.photographs).toBe(3);
  });
});

describe("152 plan versus actual", () => {
  it("flags only a run unusual for its lane", async () => {
    for (let i = 0; i < 6; i++) {
      const t = await startTrip({ tenantId, assetId: truckId, originText: "A", destinationText: "B", startedAt: new Date(Date.now() - (30 - i) * DAY) });
      await endTrip(tenantId, t.id, { distanceKm: 100 + (i % 2), at: new Date(Date.now() - (30 - i) * DAY + H) });
    }
    const odd = await startTrip({ tenantId, assetId: truckId, originText: "A", destinationText: "B", startedAt: new Date(Date.now() - 2 * DAY) });
    await endTrip(tenantId, odd.id, { distanceKm: 160, at: new Date(Date.now() - 2 * DAY + H) });
    const devs = await routeDeviations(tenantId);
    expect(devs).toHaveLength(1);
    expect(devs[0].tripId).toBe(odd.id);
    // Six runs alternating 100 and 101 km: the lane median is 101.
    expect(devs[0].laneMedianKm).toBe(101);
    expect(devs[0].deviationPercent).toBe(58);
  });
});
