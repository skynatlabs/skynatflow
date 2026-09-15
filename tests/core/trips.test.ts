// Trips.
//
// The distance is the number everything divides by, so most of this is about
// where it comes from and in what order of trust: odometer, then the phone's
// track, then a typed figure, then honestly nothing. And about the two
// refusals that keep it clean — a vehicle cannot be on two runs at once, and
// no position is accepted from a person who has not said yes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  startTrip,
  endTrip,
  addStop,
  departStop,
  appendTripPoints,
  recordConsent,
  haversineKm,
  trackDistanceKm,
  laneKeyFor,
} from "../../src/lib/core/trips";
import { submitExpense } from "../../src/lib/core/expenses";

let tenantId: string;
let assetId: string;
let driverId: string;
let userId: string;
let partyId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Trips Co", niche: "LOGISTICS" } });
  tenantId = t.id;
  const a = await prisma.asset.create({ data: { tenantId, name: "Bakkie", capacityUnit: "KM" } });
  assetId = a.id;
  const u = await prisma.user.create({ data: { email: `trips-${t.id}@test.local`, name: "Driver" } });
  userId = u.id;
  const m = await prisma.membership.create({ data: { tenantId, userId, role: "DRIVER" } });
  driverId = m.id;
  const p = await prisma.party.create({ data: { tenantId, name: "Drop Co", role: "CUSTOMER", city: "Sandton" } });
  partyId = p.id;
});

afterEach(async () => {
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("pure geometry", () => {
  it("measures Johannesburg to Pretoria at roughly fifty kilometres", () => {
    const km = haversineKm(-26.2041, 28.0473, -25.7479, 28.2293);
    expect(km).toBeGreaterThan(50);
    expect(km).toBeLessThan(56);
  });

  it("does not let a parked, jittery phone drive anywhere", () => {
    // Ten fixes within a few metres of each other: noise, not movement.
    const points = Array.from({ length: 10 }, (_, i) => ({
      lat: -26.2041 + (i % 2) * 0.00003,
      lng: 28.0473 + (i % 3) * 0.00003,
      accuracyM: 12,
    }));
    expect(trackDistanceKm(points)).toBe(0);
  });

  it("keys a lane by direction", () => {
    expect(laneKeyFor("Johannesburg", "Durban")).toBe("johannesburg > durban");
    expect(laneKeyFor("JHB.", "  jhb")).toBe("jhb > jhb");
    expect(laneKeyFor("Durban", "Johannesburg")).not.toBe(laneKeyFor("Johannesburg", "Durban"));
    expect(laneKeyFor("Durban", null)).toBeNull();
  });
});

describe("starting and ending", () => {
  it("starts underway, fills the stop in from the customer, and keys the lane", async () => {
    const trip = await startTrip({
      tenantId,
      assetId,
      driverId,
      purpose: "DELIVERY",
      originText: "Depot, Johannesburg",
      destinationText: "Durban",
      odometerStartKm: 1000,
      stops: [{ partyId }],
    });
    expect(trip.status).toBe("UNDERWAY");
    expect(trip.laneKey).toBe("depot johannesburg > durban");
    expect(trip.stops[0].partyId).toBe(partyId);
    expect(trip.startedAt).not.toBeNull();
  });

  it("refuses a second run on a vehicle already out", async () => {
    await startTrip({ tenantId, assetId, driverId });
    await expect(startTrip({ tenantId, assetId, driverId })).rejects.toThrow(/already on a trip/);
  });

  it("trusts the odometer over anything typed", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId, odometerStartKm: 1000 });
    const done = await endTrip(tenantId, trip.id, { odometerEndKm: 1250, distanceKm: 900 });
    expect(done.distanceKm).toBe(250);
    expect(done.distanceSource).toBe("ODOMETER");
    expect(done.status).toBe("DONE");
  });

  it("refuses an odometer that went backwards", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId, odometerStartKm: 1000 });
    await expect(endTrip(tenantId, trip.id, { odometerEndKm: 900 })).rejects.toThrow(/backwards/);
  });

  it("falls back to the phone's track, with consent", async () => {
    await recordConsent(tenantId, driverId, true);
    const trip = await startTrip({ tenantId, assetId, driverId });
    // Three fixes a kilometre apart, heading north.
    const base = Date.now();
    await appendTripPoints(tenantId, trip.id, [
      { at: new Date(base), lat: -26.2, lng: 28.0, accuracyM: 8 },
      { at: new Date(base + 60_000), lat: -26.191, lng: 28.0, accuracyM: 8 },
      { at: new Date(base + 120_000), lat: -26.182, lng: 28.0, accuracyM: 8 },
    ]);
    const done = await endTrip(tenantId, trip.id, { distanceKm: 900 });
    expect(done.distanceSource).toBe("GPS");
    expect(done.distanceKm).toBeGreaterThan(1.8);
    expect(done.distanceKm).toBeLessThan(2.2);
  });

  it("refuses positions from a driver who has not agreed", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId });
    await expect(
      appendTripPoints(tenantId, trip.id, [{ at: new Date(), lat: -26.2, lng: 28.0 }])
    ).rejects.toThrow(/not agreed/);
    expect(await prisma.tripPoint.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("uses a typed distance only when nothing better exists", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId });
    const done = await endTrip(tenantId, trip.id, { distanceKm: 42 });
    expect(done.distanceKm).toBe(42);
    expect(done.distanceSource).toBe("TYPED");
  });

  it("lets a trip end with no distance at all, and says so", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId });
    const done = await endTrip(tenantId, trip.id);
    // Left out of every per-kilometre figure rather than dragging it to zero.
    expect(done.distanceKm).toBeNull();
    expect(done.distanceSource).toBeNull();
  });

  it("fills an arrival in when only the departure was recorded", async () => {
    const trip = await startTrip({ tenantId, assetId, driverId });
    const stop = await addStop(tenantId, trip.id, { partyId });
    const left = await departStop(tenantId, stop.id);
    expect(left.arrivedAt?.getTime()).toBe(left.departedAt?.getTime());
  });
});

describe("costs on a trip", () => {
  it("tags a fuel slip to the trip's vehicle and driver without being told", async () => {
    const owner = await prisma.membership.create({
      data: { tenantId, userId: (await prisma.user.create({ data: { email: `own-${tenantId}@test.local` } })).id, role: "OWNER" },
    });
    const trip = await startTrip({ tenantId, assetId, driverId });
    const e = await submitExpense({
      tenantId,
      submittedById: owner.id,
      descriptionText: "Diesel",
      amountCents: 1_200_00,
      tripId: trip.id,
    });
    expect(e.assetId).toBe(assetId);
    expect(e.incurredById).toBe(driverId);
    await prisma.user.delete({ where: { id: owner.userId } }).catch(() => undefined);
  });

  it("will not tag a cost to another workspace's trip", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    const theirs = await startTrip({ tenantId: other.id });
    await expect(
      submitExpense({ tenantId, submittedById: driverId, descriptionText: "Diesel", amountCents: 100_00, tripId: theirs.id })
    ).rejects.toThrow(/not found/);
    await prisma.trip.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
