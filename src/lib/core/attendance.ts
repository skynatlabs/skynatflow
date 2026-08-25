// Clock-in/out + timesheet — the remote/field-work attendance gap flagged
// earlier this session. Deliberately simple: one open TimeEntry per person
// at a time, no geofencing/break tracking in v1.

import { prisma } from "@/lib/db";

export async function clockIn(tenantId: string, membershipId: string, notes?: string) {
  const open = await prisma.timeEntry.findFirst({
    where: { tenantId, membershipId, clockOutAt: null },
  });
  if (open) throw new Error("Already clocked in — clock out first.");

  return prisma.timeEntry.create({ data: { tenantId, membershipId, notes } });
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
