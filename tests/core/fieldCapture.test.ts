// Proof of work captured with no signal and sent later: applied once, at the
// time it happened, and refused when the phone's clock cannot be believed.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { startTrip, addStop } from "../../src/lib/core/trips";
import { applyFieldCaptures } from "../../src/lib/core/fieldCapture";

let tenantId: string;
let stopId: string;
const H = 3_600_000;
const PNG = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Field Co", niche: "LOGISTICS" } });
  tenantId = t.id;
  const party = await prisma.party.create({ data: { tenantId, name: "Farm Gate", role: "CUSTOMER" } });
  const trip = await startTrip({ tenantId, purpose: "DELIVERY" });
  stopId = (await addStop(tenantId, trip.id, { partyId: party.id })).id;
});

afterEach(async () => {
  await prisma.fieldSync.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("field captures sent after the signal returns", () => {
  it("records arrival and departure at the times they happened, in order, whatever order they arrive in", async () => {
    const arrived = new Date(Date.now() - 3 * H);
    const left = new Date(Date.now() - 1 * H);
    const out = await applyFieldCaptures(tenantId, [
      { id: "cap-depart-0001", kind: "stop.depart", stopId, at: left.toISOString() },
      { id: "cap-arrive-0001", kind: "stop.arrive", stopId, at: arrived.toISOString() },
    ]);
    expect(out.every((o) => o.status === "applied")).toBe(true);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: stopId } });
    expect(stop.arrivedAt?.toISOString()).toBe(arrived.toISOString());
    expect(stop.departedAt?.toISOString()).toBe(left.toISOString());
  });

  it("applies a resent capture once", async () => {
    const cap = { id: "cap-arrive-0002", kind: "stop.arrive" as const, stopId, at: new Date(Date.now() - H).toISOString() };
    await applyFieldCaptures(tenantId, [cap]);
    const again = await applyFieldCaptures(tenantId, [cap]);
    expect(again[0].status).toBe("duplicate");
  });

  it("applies the same capture once even when two requests carry it at the same time", async () => {
    const cap = { id: "cap-proof-race-01", kind: "stop.proof" as const, stopId, at: new Date(Date.now() - H).toISOString(), signature: PNG, signedBy: "J Dube" };
    const [a, b] = await Promise.all([applyFieldCaptures(tenantId, [cap]), applyFieldCaptures(tenantId, [cap])]);
    expect([a[0].status, b[0].status].sort()).toEqual(["applied", "duplicate"]);
    expect(await prisma.event.count({ where: { tenantId } })).toBe(1);
  });

  it("records proof as a delivery event linked to the stop, with who signed", async () => {
    const at = new Date(Date.now() - 2 * H);
    await applyFieldCaptures(tenantId, [{ id: "cap-proof-0001", kind: "stop.proof", stopId, at: at.toISOString(), signature: PNG, signedBy: "J Dube", lat: -26.1, lng: 28.0 }]);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: stopId }, include: { event: true } });
    expect(stop.event?.type).toBe("DELIVERY");
    expect(stop.event?.notes).toContain("J Dube");
    expect(stop.event?.createdAt.toISOString()).toBe(at.toISOString());
    expect(stop.arrivedAt?.toISOString()).toBe(at.toISOString());
  });

  it("refuses a capture from a clock set in the future, and proof with nothing in it", async () => {
    const out = await applyFieldCaptures(tenantId, [
      { id: "cap-future-0001", kind: "stop.arrive", stopId, at: new Date(Date.now() + 2 * H).toISOString() },
      { id: "cap-empty-00001", kind: "stop.proof", stopId, at: new Date().toISOString() },
    ]);
    expect(out.map((o) => o.status)).toEqual(["refused", "refused"]);
    // A refused capture releases its claim.
    expect(await prisma.fieldSync.count({ where: { tenantId } })).toBe(0);
  });

  it("will not touch another workspace's stop", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    const out = await applyFieldCaptures(other.id, [{ id: "cap-cross-00001", kind: "stop.arrive", stopId, at: new Date().toISOString() }]);
    expect(out[0].status).toBe("refused");
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
