// The verification is the product, so the tests that matter are about the
// distance check being honest: it is computed here and never trusted from
// the phone, a missing pin says so rather than passing, and being outside
// the radius is a flag for a person rather than an accusation.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole, VisitOutcome } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  saveOutlet,
  listOutlets,
  saveRoute,
  listRoutes,
  todaysCalls,
  startVisit,
  endVisit,
  coverage,
  outletsGoneQuiet,
  outletVisits,
  VERIFY_RADIUS_METRES,
} from "../../src/lib/core/outlets";

let tenantId: string;
let membershipId: string;
let userId: string;

// A real pair of coordinates in Soweto, and a point ~2km away.
const SHOP = { lat: -26.2485, lng: 27.8546 };
const FAR = { lat: -26.2665, lng: 27.8546 };

async function party(name: string) {
  const p = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name } });
  return p.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Outlet Test Distributor", niche: "WHOLESALE" } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: { email: `rep-${tenant.id}@example.test`, name: "Lerato Dlamini" },
  });
  userId = user.id;
  const membership = await prisma.membership.create({
    data: { tenantId, userId, role: "REP" },
  });
  membershipId = membership.id;
});

afterAll(async () => {
  await prisma.outletVisit.deleteMany({ where: { tenantId } });
  await prisma.outlet.deleteMany({ where: { tenantId } });
  await prisma.salesRoute.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.outletVisit.deleteMany({ where: { tenantId } });
  await prisma.outlet.deleteMany({ where: { tenantId } });
  await prisma.salesRoute.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
});

describe("putting a shop on the map", () => {
  it("keeps the identity on the customer record", async () => {
    const partyId = await party("Mama Ntuli Spaza");
    const outlet = await saveOutlet({
      tenantId,
      partyId,
      channel: "spaza",
      tier: "b",
      landmark: "after the blue mosque, third gate",
      ...SHOP,
    });
    expect(outlet.partyId).toBe(partyId);
    expect(outlet.tier).toBe("B");
    expect(outlet.landmark).toBe("after the blue mosque, third gate");
  });

  it("updates rather than duplicating", async () => {
    const partyId = await party("Shop");
    await saveOutlet({ tenantId, partyId, channel: "spaza" });
    await saveOutlet({ tenantId, partyId, channel: "tavern" });
    const outlets = await listOutlets(tenantId);
    expect(outlets).toHaveLength(1);
    expect(outlets[0].channel).toBe("tavern");
  });

  it("refuses a customer from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "RETAIL" } });
    const stranger = await prisma.party.create({
      data: { tenantId: other.id, role: PartyRole.CUSTOMER, name: "Theirs" },
    });
    await expect(saveOutlet({ tenantId, partyId: stranger.id })).rejects.toThrow(/not in this workspace/i);
    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("routes", () => {
  it("names a journey plan and counts what is on it", async () => {
    const route = await saveRoute({ tenantId, name: "Monday — Orlando East", membershipId, dayOfWeek: 1 });
    const partyId = await party("Shop A");
    await saveOutlet({ tenantId, partyId, routeId: route.id });

    const routes = await listRoutes(tenantId);
    expect(routes[0].name).toBe("Monday — Orlando East");
    expect(routes[0]._count.outlets).toBe(1);
  });

  it("refuses a nameless route", async () => {
    await expect(saveRoute({ tenantId, name: "  " })).rejects.toThrow(/needs a name/i);
  });

  it("clamps a day of the week into range", async () => {
    const route = await saveRoute({ tenantId, name: "R", dayOfWeek: 99 });
    expect(route.dayOfWeek).toBe(7);
  });

  it("refuses a rep from another team", async () => {
    await expect(saveRoute({ tenantId, name: "R", membershipId: "nope" })).rejects.toThrow(/not on this team/i);
  });
});

describe("today's calls", () => {
  it("includes a shop past its cadence even when today is not its route day", async () => {
    const partyId = await party("Overdue Shop");
    await saveOutlet({ tenantId, partyId, visitFrequencyDays: 7 });
    const calls = await todaysCalls({ tenantId });
    expect(calls.map((c) => c.name)).toContain("Overdue Shop");
    expect(calls[0].overdue).toBe(true);
  });

  it("leaves out a shop visited inside its cadence", async () => {
    const partyId = await party("Seen Yesterday");
    const outlet = await saveOutlet({ tenantId, partyId, visitFrequencyDays: 7 });
    await prisma.outlet.update({
      where: { id: outlet.id },
      data: { lastVisitAt: new Date(Date.now() - 86_400_000) },
    });
    const calls = await todaysCalls({ tenantId });
    expect(calls.map((c) => c.name)).not.toContain("Seen Yesterday");
  });

  it("puts A-grade shops ahead of C-grade ones when both are overdue", async () => {
    const c = await party("C shop");
    const a = await party("A shop");
    await saveOutlet({ tenantId, partyId: c, tier: "C", visitFrequencyDays: 7 });
    await saveOutlet({ tenantId, partyId: a, tier: "A", visitFrequencyDays: 7 });
    const calls = await todaysCalls({ tenantId });
    expect(calls[0].name).toBe("A shop");
  });
});

describe("arriving at a shop", () => {
  let outletId: string;

  beforeEach(async () => {
    const partyId = await party("Mama Ntuli Spaza");
    const outlet = await saveOutlet({ tenantId, partyId, ...SHOP });
    outletId = outlet.id;
  });

  it("verifies a visit taken at the door", async () => {
    const visit = await startVisit({ tenantId, outletId, membershipId, ...SHOP });
    expect(visit.verified).toBe(true);
    expect(visit.distanceMetres).toBeLessThan(VERIFY_RADIUS_METRES);
  });

  it("flags one taken two kilometres away, without calling it a lie", async () => {
    const visit = await startVisit({ tenantId, outletId, membershipId, ...FAR });
    expect(visit.verified).toBe(false);
    expect(visit.distanceMetres).toBeGreaterThan(1500);
    expect(visit.note).toMatch(/pin may be wrong|no usable signal/i);
    expect(visit.note).not.toMatch(/lied|fake|cheat/i);
  });

  it("says plainly when there is no pin to check against", async () => {
    const partyId = await party("No Pin Shop");
    const outlet = await saveOutlet({ tenantId, partyId });
    const visit = await startVisit({ tenantId, outletId: outlet.id, membershipId, ...SHOP });
    expect(visit.verified).toBe(false);
    expect(visit.distanceMetres).toBeNull();
    expect(visit.note).toMatch(/no pin recorded/i);
  });

  it("says plainly when the phone sent no location", async () => {
    const visit = await startVisit({ tenantId, outletId, membershipId });
    expect(visit.verified).toBe(false);
    expect(visit.note).toMatch(/no location came from the phone/i);
  });

  it("moves the shop's last-visited stamp", async () => {
    await startVisit({ tenantId, outletId, membershipId, ...SHOP });
    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
    expect(outlet.lastVisitAt).not.toBeNull();
  });

  it("refuses a rep who is not on this team", async () => {
    await expect(
      startVisit({ tenantId, outletId, membershipId: "nope", ...SHOP })
    ).rejects.toThrow(/not on this team/i);
  });

  it("records the outcome on the way out", async () => {
    const visit = await startVisit({ tenantId, outletId, membershipId, ...SHOP });
    await endVisit({
      tenantId,
      visitId: visit.visitId,
      outcome: VisitOutcome.NO_ORDER,
      note: "Owner away, come back Thursday",
    });
    const rows = await outletVisits(tenantId, outletId);
    expect(rows[0].outcome).toBe("NO_ORDER");
    expect(rows[0].departedAt).not.toBeNull();
  });
});

describe("coverage", () => {
  it("measures strike rate, not visit count", async () => {
    const a = await party("Shop A");
    const b = await party("Shop B");
    const outletA = await saveOutlet({ tenantId, partyId: a, ...SHOP });
    const outletB = await saveOutlet({ tenantId, partyId: b, ...SHOP });

    const v1 = await startVisit({ tenantId, outletId: outletA.id, membershipId, ...SHOP });
    await endVisit({ tenantId, visitId: v1.visitId, outcome: VisitOutcome.ORDER });
    const v2 = await startVisit({ tenantId, outletId: outletB.id, membershipId, ...SHOP });
    await endVisit({ tenantId, visitId: v2.visitId, outcome: VisitOutcome.NO_ORDER });

    const report = await coverage(tenantId, 30);
    expect(report.rows[0].visits).toBe(2);
    expect(report.rows[0].orders).toBe(1);
    expect(report.rows[0].strikeRatePercent).toBe(50);
    expect(report.coveragePercent).toBe(100);
  });

  it("counts unverified visits separately", async () => {
    const partyId = await party("Shop");
    const outlet = await saveOutlet({ tenantId, partyId, ...SHOP });
    const v = await startVisit({ tenantId, outletId: outlet.id, membershipId, ...FAR });
    await endVisit({ tenantId, visitId: v.visitId, outcome: VisitOutcome.ORDER });

    const report = await coverage(tenantId, 30);
    expect(report.rows[0].unverified).toBe(1);
    expect(report.rows[0].verified).toBe(0);
  });

  it("says so plainly when there are no outlets", async () => {
    const report = await coverage(tenantId, 30);
    expect(report.summary).toMatch(/no outlets/i);
  });
});

describe("shops that stopped buying", () => {
  it("separates not-ordering from not-being-visited", async () => {
    const partyId = await party("Lost Listing");
    const outlet = await saveOutlet({ tenantId, partyId, ...SHOP });
    // Visited yesterday, but has never ordered.
    await prisma.outlet.update({
      where: { id: outlet.id },
      data: { lastVisitAt: new Date(Date.now() - 86_400_000) },
    });

    const quiet = await outletsGoneQuiet(tenantId, 45);
    expect(quiet).toHaveLength(1);
    expect(quiet[0].daysSinceVisit).toBe(1);
    expect(quiet[0].daysSinceOrder).toBeNull();
  });

  it("leaves a shop that ordered recently alone", async () => {
    const partyId = await party("Still Buying");
    await saveOutlet({ tenantId, partyId });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 5000 },
    });
    expect(await outletsGoneQuiet(tenantId, 45)).toHaveLength(0);
  });
});
