// The geofence is the whole product, so the tests that matter are about it
// being honest: a sign-on at the gate is confirmed, one from home is flagged
// with a distance and never with an accusation, and a site with no pin says
// nothing could be checked rather than quietly passing.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { clockIn, clockOut } from "../../src/lib/core/attendance";
import {
  saveWorkSite,
  listWorkSites,
  saveShift,
  deleteShift,
  listShifts,
  unfilledShifts,
  labourForecast,
  signOnsToCheck,
  shiftAdherence,
} from "../../src/lib/core/workforce";

let tenantId: string;
let membershipId: string;
let otherMembershipId: string;
let userId: string;
let otherUserId: string;

const GATE = { lat: -26.2041, lng: 28.0473 };
const HOME = { lat: -26.2441, lng: 28.0873 };

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Workforce Test Security", niche: "SERVICES" } });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `guard-${tenant.id}@example.test`, name: "Sipho Ndlovu" } });
  userId = user.id;
  membershipId = (await prisma.membership.create({ data: { tenantId, userId, role: "STAFF" } })).id;

  const other = await prisma.user.create({ data: { email: `guard2-${tenant.id}@example.test`, name: "Naledi Khoza" } });
  otherUserId = other.id;
  otherMembershipId = (await prisma.membership.create({ data: { tenantId, userId: other.id, role: "STAFF" } })).id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
  await prisma.workSite.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
  await prisma.workSite.deleteMany({ where: { tenantId } });
});

describe("sites", () => {
  it("will not accept a radius tight enough to flag honest people", async () => {
    const site = await saveWorkSite({ tenantId, name: "Main gate", radiusMetres: 5 });
    expect(site.radiusMetres).toBe(50);
  });

  it("refuses a nameless site", async () => {
    await expect(saveWorkSite({ tenantId, name: " " })).rejects.toThrow(/needs a name/i);
  });

  it("updates rather than duplicating", async () => {
    const site = await saveWorkSite({ tenantId, name: "Gate" });
    await saveWorkSite({ tenantId, siteId: site.id, name: "Main gate" });
    const sites = await listWorkSites(tenantId);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe("Main gate");
  });
});

describe("signing on", () => {
  let siteId: string;

  beforeEach(async () => {
    siteId = (await saveWorkSite({ tenantId, name: "Main gate", ...GATE, radiusMetres: 150 })).id;
  });

  it("confirms a sign-on taken at the gate", async () => {
    const entry = await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...GATE });
    expect(entry.verified).toBe(true);
    expect(entry.distanceMetres).toBeLessThan(150);
  });

  it("flags one taken from home, with the distance", async () => {
    const entry = await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...HOME });
    expect(entry.verified).toBe(false);
    expect(entry.distanceMetres).toBeGreaterThan(4000);
  });

  it("stays unconfirmed when the site has no pin", async () => {
    const noPin = await saveWorkSite({ tenantId, name: "No pin" });
    const entry = await clockIn(tenantId, membershipId, undefined, { workSiteId: noPin.id, ...GATE });
    expect(entry.verified).toBe(false);
    expect(entry.distanceMetres).toBeNull();
  });

  it("still works with no site at all, for a business in one building", async () => {
    const entry = await clockIn(tenantId, membershipId);
    expect(entry.workSiteId).toBeNull();
    expect(entry.verified).toBe(false);
  });

  it("refuses a site from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    const theirs = await prisma.workSite.create({ data: { tenantId: other.id, name: "Theirs" } });
    await expect(
      clockIn(tenantId, membershipId, undefined, { workSiteId: theirs.id })
    ).rejects.toThrow(/not in this workspace/i);
    await prisma.workSite.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("still refuses a second open entry", async () => {
    await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...GATE });
    await expect(clockIn(tenantId, membershipId)).rejects.toThrow(/already clocked in/i);
    await clockOut(tenantId, membershipId);
  });
});

describe("sign-ons a supervisor should look at", () => {
  it("gives a reason for each, and never an accusation", async () => {
    const siteId = (await saveWorkSite({ tenantId, name: "Main gate", ...GATE })).id;
    await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...HOME });

    const flags = await signOnsToCheck(tenantId, 7);
    expect(flags).toHaveLength(1);
    expect(flags[0].memberName).toBe("Sipho Ndlovu");
    expect(flags[0].reason).toMatch(/pin may be wrong|no usable signal/i);
    expect(flags[0].reason).not.toMatch(/ghost|fraud|lied|stealing/i);
  });

  it("explains a missing pin differently from a missing fix", async () => {
    const noPin = await saveWorkSite({ tenantId, name: "No pin" });
    await clockIn(tenantId, membershipId, undefined, { workSiteId: noPin.id, ...GATE });
    const flags = await signOnsToCheck(tenantId, 7);
    expect(flags[0].reason).toMatch(/no pin recorded/i);
  });

  it("leaves a confirmed sign-on out", async () => {
    const siteId = (await saveWorkSite({ tenantId, name: "Main gate", ...GATE })).id;
    await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...GATE });
    expect(await signOnsToCheck(tenantId, 7)).toHaveLength(0);
  });
});

describe("the roster", () => {
  it("refuses to book one person onto two overlapping shifts", async () => {
    await saveShift({ tenantId, membershipId, startsAt: at(1), endsAt: at(9) });
    await expect(
      saveShift({ tenantId, membershipId, startsAt: at(5), endsAt: at(13) })
    ).rejects.toThrow(/overlaps/i);
  });

  it("allows two people on the same hours", async () => {
    await saveShift({ tenantId, membershipId, startsAt: at(1), endsAt: at(9) });
    const second = await saveShift({
      tenantId,
      membershipId: otherMembershipId,
      startsAt: at(1),
      endsAt: at(9),
    });
    expect(second.id).toBeDefined();
  });

  it("refuses a shift that ends before it starts", async () => {
    await expect(saveShift({ tenantId, startsAt: at(9), endsAt: at(1) })).rejects.toThrow(
      /end after it starts/i
    );
  });

  it("marks an unassigned shift as planned rather than filled", async () => {
    const shift = await saveShift({ tenantId, startsAt: at(1), endsAt: at(9) });
    expect(shift.status).toBe("PLANNED");
    expect(shift.membershipId).toBeNull();
  });

  it("lets a shift be moved without tripping its own overlap check", async () => {
    const shift = await saveShift({ tenantId, membershipId, startsAt: at(1), endsAt: at(9) });
    const moved = await saveShift({
      tenantId,
      shiftId: shift.id,
      membershipId,
      startsAt: at(2),
      endsAt: at(10),
    });
    expect(moved.id).toBe(shift.id);
  });

  it("deletes", async () => {
    const shift = await saveShift({ tenantId, startsAt: at(1), endsAt: at(9) });
    expect(await deleteShift(tenantId, shift.id)).toBe(true);
    expect(await deleteShift(tenantId, shift.id)).toBe(false);
  });

  it("lists a window in order", async () => {
    await saveShift({ tenantId, startsAt: at(30), endsAt: at(38) });
    await saveShift({ tenantId, startsAt: at(2), endsAt: at(10) });
    const shifts = await listShifts({ tenantId, from: new Date(), to: at(100) });
    expect(shifts[0].startsAt.getTime()).toBeLessThan(shifts[1].startsAt.getTime());
  });
});

describe("gaps", () => {
  it("lists unfilled shifts soonest first", async () => {
    const site = await saveWorkSite({ tenantId, name: "Main gate" });
    await saveShift({ tenantId, workSiteId: site.id, startsAt: at(72), endsAt: at(80), role: "guard" });
    await saveShift({ tenantId, workSiteId: site.id, startsAt: at(3), endsAt: at(11), role: "guard" });

    const gaps = await unfilledShifts(tenantId, 14);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].hoursUntil).toBeLessThan(gaps[1].hoursUntil);
    expect(gaps[0].siteName).toBe("Main gate");
  });

  it("leaves a filled shift out", async () => {
    await saveShift({ tenantId, membershipId, startsAt: at(3), endsAt: at(11) });
    expect(await unfilledShifts(tenantId, 14)).toHaveLength(0);
  });
});

describe("what the roster will cost", () => {
  it("prices the hours and names the shifts with no rate", async () => {
    await saveShift({ tenantId, membershipId, startsAt: at(1), endsAt: at(9), ratePerHourCents: 3000 });
    await saveShift({ tenantId, startsAt: at(10), endsAt: at(14) });

    const forecast = await labourForecast({ tenantId, from: new Date(), to: at(100) });
    expect(forecast.shifts).toBe(2);
    expect(forecast.filled).toBe(1);
    expect(forecast.hours).toBe(12);
    expect(forecast.costCents).toBe(24000);
    expect(forecast.shiftsWithoutRate).toBe(1);
  });

  it("says so plainly when nothing is rostered", async () => {
    const forecast = await labourForecast({ tenantId, from: new Date(), to: at(100) });
    expect(forecast.summary).toMatch(/nothing rostered/i);
  });
});

describe("who turned up", () => {
  it("counts a shift as worked when somebody signed on inside it", async () => {
    const siteId = (await saveWorkSite({ tenantId, name: "Main gate", ...GATE })).id;
    await saveShift({ tenantId, membershipId, workSiteId: siteId, startsAt: at(-2), endsAt: at(6) });
    await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...GATE });

    const rows = await shiftAdherence({ tenantId, from: at(-24), to: at(24) });
    expect(rows[0].shifts).toBe(1);
    expect(rows[0].signedOn).toBe(1);
    expect(rows[0].confirmedAtSite).toBe(1);
    expect(rows[0].missed).toBe(0);
  });

  it("counts a shift nobody signed on for as missed", async () => {
    await saveShift({ tenantId, membershipId, startsAt: at(-10), endsAt: at(-2) });
    const rows = await shiftAdherence({ tenantId, from: at(-24), to: at(24) });
    expect(rows[0].missed).toBe(1);
  });

  it("forgives arriving inside the hour of grace", async () => {
    const siteId = (await saveWorkSite({ tenantId, name: "Gate", ...GATE })).id;
    await saveShift({ tenantId, membershipId, workSiteId: siteId, startsAt: at(0.5), endsAt: at(8) });
    // Signed on now, half an hour early.
    await clockIn(tenantId, membershipId, undefined, { workSiteId: siteId, ...GATE });

    const rows = await shiftAdherence({ tenantId, from: at(-24), to: at(24) });
    expect(rows[0].signedOn).toBe(1);
  });
});
