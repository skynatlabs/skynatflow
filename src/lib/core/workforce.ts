// Rosters, sites, and proving somebody was at one.
//
// Three products in most markets — scheduling, attendance, and labour
// costing — and one problem here, because in guarding, cleaning, farm labour
// and packing they are the same problem: a business commits to putting
// people somewhere, pays for the hours whether or not they were there, and
// has no way to tell the difference.
//
// WHY THE GEOFENCE IS THE WHOLE PRODUCT.
//
// African security firms alone employ millions of guards across thousands of
// sites, and today the supervisor verifies attendance by telephoning the
// gate. That is not a joke, it is the industry standard, and it is why
// ghost workers are endemic. A coordinate taken at the gate costs nothing
// and settles it. That single feature is what makes the sale; everything
// else here is what makes it usable afterwards.
//
// WHY AN UNFILLED SHIFT IS THE SECOND FEATURE.
//
// A roster's failure mode is not a bad plan, it is a gap nobody noticed
// until the client phoned. So an open shift is a first-class thing with a
// status, not the absence of a record.
//
// ON CALLING ANYBODY A GHOST.
//
// This module reports a sign-on that could not be placed at the site, with
// the distance, and stops there. A phone in a basement has no fix at all, a
// site pin gets recorded from the wrong side of a wall, and a cheap handset
// on a cold start can be a kilometre out while sitting still. Somebody's
// job is not something software should end on a number it cannot explain.

import { ShiftStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface WorkSiteInput {
  tenantId: string;
  siteId?: string;
  name: string;
  partyId?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusMetres?: number;
  landmark?: string | null;
  isActive?: boolean;
}

export async function saveWorkSite(input: WorkSiteInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A site needs a name.");

  if (input.partyId) {
    const party = await prisma.party.findFirst({
      where: { id: input.partyId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!party) throw new Error("That client is not in this workspace.");
  }

  const data = {
    name,
    partyId: input.partyId ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    // A radius under fifty metres flags honest people: a consumer phone in a
    // built-up area rarely does better than that.
    radiusMetres: Math.max(50, Math.round(input.radiusMetres ?? 150)),
    landmark: input.landmark?.trim().slice(0, 300) || null,
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };

  if (input.siteId) {
    const existing = await prisma.workSite.findFirst({
      where: { id: input.siteId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!existing) throw new Error("Site not found.");
    return prisma.workSite.update({ where: { id: input.siteId }, data });
  }

  return prisma.workSite.create({ data: { tenantId: input.tenantId, ...data } });
}

export async function listWorkSites(tenantId: string, activeOnly = true) {
  return prisma.workSite.findMany({
    where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
    take: 1000,
    include: { party: { select: { name: true } } },
  });
}

export interface ShiftInput {
  tenantId: string;
  shiftId?: string;
  workSiteId?: string | null;
  membershipId?: string | null;
  startsAt: Date;
  endsAt: Date;
  role?: string | null;
  ratePerHourCents?: number | null;
  note?: string | null;
}

/**
 * Put a line on the roster.
 *
 * Refuses to book the same person into two shifts that overlap. A roster
 * that lets one guard cover two gates at once is not a roster, and the
 * mistake is silent until the client phones.
 */
export async function saveShift(input: ShiftInput) {
  if (input.endsAt <= input.startsAt) throw new Error("A shift has to end after it starts.");

  if (input.workSiteId) {
    const site = await prisma.workSite.findFirst({
      where: { id: input.workSiteId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!site) throw new Error("That site is not in this workspace.");
  }

  if (input.membershipId) {
    const member = await prisma.membership.findFirst({
      where: { id: input.membershipId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!member) throw new Error("That person is not on this team.");

    const clash = await prisma.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        ...(input.shiftId ? { id: { not: input.shiftId } } : {}),
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
      select: { id: true, startsAt: true },
    });
    if (clash) {
      throw new Error("That person is already on a shift that overlaps this one.");
    }
  }

  const data = {
    workSiteId: input.workSiteId ?? null,
    membershipId: input.membershipId ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    role: input.role?.trim().slice(0, 60) || null,
    ratePerHourCents:
      input.ratePerHourCents == null ? null : Math.max(0, Math.round(input.ratePerHourCents)),
    note: input.note?.trim().slice(0, 300) || null,
    status: input.membershipId ? ShiftStatus.FILLED : ShiftStatus.PLANNED,
  };

  if (input.shiftId) {
    const existing = await prisma.shift.findFirst({
      where: { id: input.shiftId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!existing) throw new Error("Shift not found.");
    return prisma.shift.update({ where: { id: input.shiftId }, data });
  }

  return prisma.shift.create({ data: { tenantId: input.tenantId, ...data } });
}

export async function deleteShift(tenantId: string, shiftId: string) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, tenantId }, select: { id: true } });
  if (!shift) return false;
  await prisma.shift.delete({ where: { id: shiftId } });
  return true;
}

export async function listShifts(params: {
  tenantId: string;
  from: Date;
  to: Date;
  membershipId?: string;
  workSiteId?: string;
}) {
  return prisma.shift.findMany({
    where: {
      tenantId: params.tenantId,
      startsAt: { gte: params.from, lt: params.to },
      ...(params.membershipId ? { membershipId: params.membershipId } : {}),
      ...(params.workSiteId ? { workSiteId: params.workSiteId } : {}),
    },
    orderBy: { startsAt: "asc" },
    take: 2000,
    include: { workSite: { select: { name: true } } },
  });
}

export interface RosterGap {
  shiftId: string;
  siteName: string | null;
  role: string | null;
  startsAt: Date;
  endsAt: Date;
  hoursUntil: number;
}

/**
 * Shifts with nobody on them.
 *
 * Soonest first, because a gap tomorrow morning is a different problem from
 * a gap in three weeks and a list sorted any other way buries the first.
 */
export async function unfilledShifts(
  tenantId: string,
  withinDays = 14,
  now = new Date()
): Promise<RosterGap[]> {
  const shifts = await prisma.shift.findMany({
    where: {
      tenantId,
      membershipId: null,
      startsAt: { gte: now, lt: new Date(now.getTime() + withinDays * 86_400_000) },
      status: { not: ShiftStatus.DONE },
    },
    orderBy: { startsAt: "asc" },
    take: 500,
    include: { workSite: { select: { name: true } } },
  });

  return shifts.map((s) => ({
    shiftId: s.id,
    siteName: s.workSite?.name ?? null,
    role: s.role,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    hoursUntil: Math.round((s.startsAt.getTime() - now.getTime()) / 3_600_000),
  }));
}

export interface LabourForecast {
  shifts: number;
  filled: number;
  unfilled: number;
  hours: number;
  costCents: number;
  /** Shifts with no rate, so the cost above is a floor rather than the total. */
  shiftsWithoutRate: number;
  summary: string;
}

/**
 * What the roster will cost before anybody works it.
 *
 * Reports how many shifts carry no rate rather than treating them as free,
 * for the same reason a plate cost names its uncosted ingredients: a total
 * that quietly assumes zero is worse than no total.
 */
export async function labourForecast(params: {
  tenantId: string;
  from: Date;
  to: Date;
}): Promise<LabourForecast> {
  const shifts = await prisma.shift.findMany({
    where: { tenantId: params.tenantId, startsAt: { gte: params.from, lt: params.to } },
    select: { membershipId: true, startsAt: true, endsAt: true, ratePerHourCents: true },
    take: 5000,
  });

  let hours = 0;
  let costCents = 0;
  let withoutRate = 0;
  let filled = 0;

  for (const shift of shifts) {
    const h = (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
    hours += h;
    if (shift.membershipId) filled += 1;
    if (shift.ratePerHourCents == null) withoutRate += 1;
    else costCents += Math.round(h * shift.ratePerHourCents);
  }

  return {
    shifts: shifts.length,
    filled,
    unfilled: shifts.length - filled,
    hours: Math.round(hours * 10) / 10,
    costCents,
    shiftsWithoutRate: withoutRate,
    summary:
      shifts.length === 0
        ? "Nothing rostered in this window."
        : `${shifts.length} shifts, ${Math.round(hours)} hours` +
          (withoutRate > 0 ? `, ${withoutRate} with no rate set.` : "."),
  };
}

export interface SignOnFlag {
  timeEntryId: string;
  memberName: string;
  siteName: string | null;
  clockInAt: Date;
  distanceMetres: number | null;
  /** Why it could not be confirmed, in words a supervisor can act on. */
  reason: string;
}

/**
 * Sign-ons that could not be placed at the site.
 *
 * Deliberately NOT called a ghost-worker report, and deliberately not a
 * score. It is a list of sign-ons a supervisor should look at, each with the
 * reason it could not be confirmed, because every one of those reasons has
 * an innocent version and the software cannot tell which it is looking at.
 */
export async function signOnsToCheck(
  tenantId: string,
  sinceDays = 7,
  now = new Date()
): Promise<SignOnFlag[]> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);

  const entries = await prisma.timeEntry.findMany({
    where: { tenantId, clockInAt: { gte: since }, workSiteId: { not: null }, verified: false },
    orderBy: { clockInAt: "desc" },
    take: 500,
    include: { workSite: { select: { name: true, lat: true, lng: true } } },
  });
  if (entries.length === 0) return [];

  const memberships = await prisma.membership.findMany({
    where: { tenantId, id: { in: entries.map((e) => e.membershipId) } },
    select: { id: true, user: { select: { name: true, email: true } } },
    take: 500,
  });
  const nameOf = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));

  return entries.map((e) => ({
    timeEntryId: e.id,
    memberName: nameOf.get(e.membershipId) ?? "Someone",
    siteName: e.workSite?.name ?? null,
    clockInAt: e.clockInAt,
    distanceMetres: e.distanceMetres,
    reason:
      e.distanceMetres !== null
        ? `${e.distanceMetres}m from the site. The pin may be wrong, or there may be no usable signal where they stood.`
        : e.workSite?.lat == null
          ? "This site has no pin recorded, so nothing could be checked."
          : "The phone sent no location — it may have had GPS switched off, or no fix indoors.",
  }));
}

export interface AdherenceRow {
  membershipId: string;
  name: string;
  shifts: number;
  signedOn: number;
  confirmedAtSite: number;
  missed: number;
}

/**
 * Who turned up for what they were rostered on.
 *
 * A shift is counted as signed on when a clock-in exists inside its window,
 * with an hour of grace either side: somebody arriving ten minutes early is
 * not a discrepancy and treating it as one teaches people to ignore the
 * report.
 */
export async function shiftAdherence(params: {
  tenantId: string;
  from: Date;
  to: Date;
}): Promise<AdherenceRow[]> {
  const GRACE_MS = 3_600_000;

  const [shifts, entries, memberships] = await Promise.all([
    prisma.shift.findMany({
      where: {
        tenantId: params.tenantId,
        startsAt: { gte: params.from, lt: params.to },
        membershipId: { not: null },
      },
      select: { membershipId: true, startsAt: true, endsAt: true },
      take: 5000,
    }),
    prisma.timeEntry.findMany({
      where: {
        tenantId: params.tenantId,
        clockInAt: {
          gte: new Date(params.from.getTime() - GRACE_MS),
          lt: new Date(params.to.getTime() + GRACE_MS),
        },
      },
      select: { membershipId: true, clockInAt: true, verified: true },
      take: 10000,
    }),
    prisma.membership.findMany({
      where: { tenantId: params.tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
      take: 500,
    }),
  ]);

  const nameOf = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  const byPerson = new Map<string, AdherenceRow>();

  for (const shift of shifts) {
    const id = shift.membershipId!;
    const row =
      byPerson.get(id) ??
      ({
        membershipId: id,
        name: nameOf.get(id) ?? "Someone",
        shifts: 0,
        signedOn: 0,
        confirmedAtSite: 0,
        missed: 0,
      } satisfies AdherenceRow);
    row.shifts += 1;

    const match = entries.find(
      (e) =>
        e.membershipId === id &&
        e.clockInAt.getTime() >= shift.startsAt.getTime() - GRACE_MS &&
        e.clockInAt.getTime() <= shift.endsAt.getTime() + GRACE_MS
    );
    if (match) {
      row.signedOn += 1;
      if (match.verified) row.confirmedAtSite += 1;
    } else {
      row.missed += 1;
    }

    byPerson.set(id, row);
  }

  return [...byPerson.values()].sort((a, b) => b.missed - a.missed);
}
