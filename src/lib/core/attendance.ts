// Clock-in/out + timesheet. One open TimeEntry per person at a time.
//
// Signing on now carries a place as well as a time. That is the difference
// between attendance software and a payroll control: a roster says somebody
// was meant to be at a gate, and only a coordinate taken at the gate says
// they were. Ghost workers — people on a payroll who are not at the site,
// or one person signing on for three — are the largest single cost leak in
// guarding, cleaning and farm labour across this continent, and nobody can
// prove it from a timesheet.
//
// The geofence is optional throughout. A workshop where everyone is in one
// building does not need it and must not be made to carry it.

import { prisma } from "@/lib/db";
import { haversineKm } from "./trips";

export interface ClockInPlace {
  workSiteId?: string | null;
  lat?: number | null;
  lng?: number | null;
  shiftId?: string | null;
}

export async function clockIn(
  tenantId: string,
  membershipId: string,
  notes?: string,
  place: ClockInPlace = {}
) {
  const open = await prisma.timeEntry.findFirst({
    where: { tenantId, membershipId, clockOutAt: null },
  });
  if (open) throw new Error("Already clocked in — clock out first.");

  let distanceMetres: number | null = null;
  let verified = false;

  if (place.workSiteId) {
    const site = await prisma.workSite.findFirst({
      where: { id: place.workSiteId, tenantId },
      select: { lat: true, lng: true, radiusMetres: true },
    });
    if (!site) throw new Error("That site is not in this workspace.");

    if (site.lat != null && site.lng != null && place.lat != null && place.lng != null) {
      distanceMetres = Math.round(haversineKm(site.lat, site.lng, place.lat, place.lng) * 1000);
      verified = distanceMetres <= site.radiusMetres;
    }
  }

  return prisma.timeEntry.create({
    data: {
      tenantId,
      membershipId,
      notes,
      workSiteId: place.workSiteId ?? null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      distanceMetres,
      verified,
      shiftId: place.shiftId ?? null,
    },
  });
}

export async function clockOut(tenantId: string, membershipId: string) {
  const open = await prisma.timeEntry.findFirst({
    where: { tenantId, membershipId, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
  });
  if (!open) throw new Error("Not currently clocked in.");

  return prisma.timeEntry.update({ where: { id: open.id }, data: { clockOutAt: new Date() } });
}

export async function getOpenEntry(tenantId: string, membershipId: string) {
  return prisma.timeEntry.findFirst({ where: { tenantId, membershipId, clockOutAt: null } });
}

export async function getTimesheet(
  tenantId: string,
  membershipId: string,
  from: Date,
  to: Date
) {
  return prisma.timeEntry.findMany({
    where: { tenantId, membershipId, clockInAt: { gte: from, lte: to } },
    orderBy: { clockInAt: "desc" },
  });
}

export async function getTeamAttendance(tenantId: string) {
  const entries = await prisma.timeEntry.findMany({
    where: { tenantId },
    orderBy: { clockInAt: "desc" },
    take: 100,
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: entries.map((e) => e.membershipId) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return entries.map((e) => ({ ...e, memberName: nameById.get(e.membershipId) ?? "Someone" }));
}
