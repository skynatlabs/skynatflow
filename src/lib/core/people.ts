// Leave, employment records, and what somebody leaves behind.
//
// Leave is the feature owners ask for more often than almost anything else,
// and the reason is not the requests — it is the question "who is away next
// Tuesday", asked before promising a customer a date. So the balance and the
// calendar matter more here than the approval workflow does.
//
// Two decisions worth stating:
//
//   Working days are computed once, when the request is made, and stored.
//   A later change to the public-holiday list must not silently restate leave
//   somebody has already taken.
//
//   Employment records are append-only. A warning that can be edited after
//   the fact is not evidence of anything, and the only reason to keep these
//   is that they hold up later.

import { prisma } from "@/lib/db";
import { LeaveKind, LeaveStatus, type EmploymentRecordKind } from "@prisma/client";

/** Statutory minimum in South Africa; a starting point, not a rule. */
export const DEFAULT_ANNUAL_LEAVE_DAYS = 15;

// ------------------------------------------------------------------- days

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}

/**
 * Working days between two dates, inclusive, skipping weekends and holidays.
 *
 * Half days are not modelled. They exist, but a half-day field on every
 * request to serve the rare case makes the common case worse, and "two days"
 * is what almost everybody means.
 */
export function workingDaysBetween(start: Date, end: Date, holidays: Date[]): number {
  const from = startOfDayUtc(start);
  const to = startOfDayUtc(end);
  if (to < from) return 0;

  const holidaySet = new Set(holidays.map((h) => startOfDayUtc(h).getTime()));

  let days = 0;
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet.has(d.getTime())) continue;
    days++;
  }
  return days;
}

export async function listHolidays(tenantId: string, year?: number) {
  const where = year
    ? {
        tenantId,
        onDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
        },
      }
    : { tenantId };
  return prisma.holiday.findMany({ where, orderBy: { onDate: "asc" } });
}

export async function addHoliday(params: { tenantId: string; name: string; onDate: Date }) {
  return prisma.holiday.create({
    data: {
      tenantId: params.tenantId,
      name: params.name.trim(),
      onDate: startOfDayUtc(params.onDate),
    },
  });
}

// ------------------------------------------------------------------ leave

export async function requestLeave(params: {
  tenantId: string;
  membershipId: string;
  kind?: LeaveKind;
  startOn: Date;
  endOn: Date;
  reason?: string;
}) {
  const member = await prisma.membership.findUnique({
    where: { id: params.membershipId },
    select: { tenantId: true },
  });
  if (!member || member.tenantId !== params.tenantId) throw new Error("Team member not found.");
  if (params.endOn < params.startOn) throw new Error("The end date is before the start date.");

  const holidays = await prisma.holiday.findMany({
    where: {
      tenantId: params.tenantId,
      onDate: { gte: startOfDayUtc(params.startOn), lte: startOfDayUtc(params.endOn) },
    },
    select: { onDate: true },
  });

  const days = workingDaysBetween(
    params.startOn,
    params.endOn,
    holidays.map((h) => h.onDate)
  );
  if (days === 0) {
    throw new Error("That range is all weekends and public holidays — no working days in it.");
  }

  return prisma.leaveRequest.create({
    data: {
      tenantId: params.tenantId,
      membershipId: params.membershipId,
      kind: params.kind ?? LeaveKind.ANNUAL,
      startOn: startOfDayUtc(params.startOn),
      endOn: startOfDayUtc(params.endOn),
      days,
      reason: params.reason?.trim() || null,
    },
  });
}

export async function decideLeave(params: {
  tenantId: string;
  leaveRequestId: string;
  approve: boolean;
  decidedById: string;
}) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: params.leaveRequestId } });
  if (!request || request.tenantId !== params.tenantId) throw new Error("Request not found.");
  if (request.status !== LeaveStatus.REQUESTED) {
    throw new Error("That request has already been decided.");
  }

  return prisma.leaveRequest.update({
    where: { id: request.id },
    data: {
      status: params.approve ? LeaveStatus.APPROVED : LeaveStatus.DECLINED,
      decidedById: params.decidedById,
      decidedAt: new Date(),
    },
  });
}

export interface LeaveBalance {
  membershipId: string;
  name: string;
  entitlementDays: number;
  takenDays: number;
  bookedDays: number;
  remainingDays: number;
  /** Requests waiting on somebody. */
  pending: number;
}

/**
 * Where everybody stands, for a leave year.
 *
 * Taken and booked are separated deliberately: days already gone and days
 * approved but still ahead are different things when somebody is deciding
 * whether they can say yes to another request.
 */
export async function leaveBalances(
  tenantId: string,
  opts: { year?: number; entitlementDays?: number } = {}
): Promise<LeaveBalance[]> {
  const year = opts.year ?? new Date().getUTCFullYear();
  const entitlement = opts.entitlementDays ?? DEFAULT_ANNUAL_LEAVE_DAYS;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const now = new Date();

  const [members, requests] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        tenantId,
        startOn: { gte: yearStart, lte: yearEnd },
        // Unpaid leave is real time off but does not draw down the annual
        // entitlement, so it is excluded from the balance rather than
        // quietly eating it.
        kind: LeaveKind.ANNUAL,
      },
      select: { membershipId: true, days: true, status: true, endOn: true },
    }),
  ]);

  return members.map((m) => {
    const mine = requests.filter((r) => r.membershipId === m.id);
    const approved = mine.filter((r) => r.status === LeaveStatus.APPROVED);
    const takenDays = approved
      .filter((r) => r.endOn <= now)
      .reduce((s, r) => s + r.days, 0);
    const bookedDays = approved
      .filter((r) => r.endOn > now)
      .reduce((s, r) => s + r.days, 0);

    return {
      membershipId: m.id,
      name: m.user?.name ?? m.user?.email ?? "Team member",
      entitlementDays: entitlement,
      takenDays,
      bookedDays,
      remainingDays: Math.round((entitlement - takenDays - bookedDays) * 10) / 10,
      pending: mine.filter((r) => r.status === LeaveStatus.REQUESTED).length,
    };
  });
}

export interface AwayPerson {
  membershipId: string;
  name: string;
  kind: LeaveKind;
  startOn: Date;
  endOn: Date;
}

/**
 * Who is away over a window.
 *
 * The actual question this feature exists to answer, and the one asked before
 * promising a customer a date.
 */
export async function whoIsAway(
  tenantId: string,
  from: Date,
  to: Date
): Promise<AwayPerson[]> {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      tenantId,
      status: LeaveStatus.APPROVED,
      // Any overlap with the window, not only requests contained by it — a
      // fortnight's leave spanning the whole week must still show up.
      startOn: { lte: to },
      endOn: { gte: from },
    },
    include: { membership: { select: { id: true, user: { select: { name: true, email: true } } } } },
    orderBy: { startOn: "asc" },
  });

  return rows.map((r) => ({
    membershipId: r.membership.id,
    name: r.membership.user?.name ?? r.membership.user?.email ?? "Team member",
    kind: r.kind,
    startOn: r.startOn,
    endOn: r.endOn,
  }));
}

export async function listLeaveRequests(
  tenantId: string,
  opts: { status?: LeaveStatus; membershipId?: string } = {}
) {
  return prisma.leaveRequest.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.membershipId ? { membershipId: opts.membershipId } : {}),
    },
    orderBy: { startOn: "desc" },
    include: { membership: { select: { user: { select: { name: true, email: true } } } } },
  });
}

// ------------------------------------------------------- employment records

export async function addEmploymentRecord(params: {
  tenantId: string;
  membershipId: string;
  kind: EmploymentRecordKind;
  title: string;
  body?: string | null;
  documentDataUrl?: string | null;
  effectiveOn?: Date;
  recordedById?: string | null;
}) {
  const member = await prisma.membership.findUnique({
    where: { id: params.membershipId },
    select: { tenantId: true },
  });
  if (!member || member.tenantId !== params.tenantId) throw new Error("Team member not found.");

  const title = params.title.trim();
  if (!title) throw new Error("Give the record a title.");

  return prisma.employmentRecord.create({
    data: {
      tenantId: params.tenantId,
      membershipId: params.membershipId,
      kind: params.kind,
      title,
      body: params.body?.trim() || null,
      documentDataUrl: params.documentDataUrl ?? null,
      effectiveOn: params.effectiveOn ?? new Date(),
      recordedById: params.recordedById ?? null,
    },
  });
}

export async function listEmploymentRecords(tenantId: string, membershipId?: string) {
  return prisma.employmentRecord.findMany({
    where: { tenantId, ...(membershipId ? { membershipId } : {}) },
    orderBy: { effectiveOn: "desc" },
    include: { membership: { select: { user: { select: { name: true, email: true } } } } },
  });
}
