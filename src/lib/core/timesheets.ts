// The week, per person, against the jobs.
//
// Clocking on to a day says somebody was at work. Clocking on to a job says
// where the money went, and the gap between those two numbers is the single
// most useful figure a service business never has: how much of what it pays
// for actually reaches a customer.
//
// Two rules that shape everything here:
//
//   AN UNCLOSED SHIFT IS NOT EIGHT HOURS. Somebody who forgot to clock off is
//   a missing fact, not a full day — filling it in would quietly inflate
//   every cost figure downstream. It is reported, not guessed.
//
//   TIME ON A JOB IS COST, NOT PAY. The rate here is what an hour costs the
//   business including on-costs, which is the number apportionment needs.
//   What somebody is paid is payroll's business and appears nowhere on this
//   screen.

import { prisma } from "@/lib/db";

export interface DayRow {
  date: string;
  minutes: number;
  /** Of those, the ones clocked against a job. */
  onJobs: number;
  /** Shifts started and never closed. */
  openShifts: number;
}

export interface JobRow {
  jobCardId: string | null;
  title: string;
  minutes: number;
  costCents: number | null;
}

export interface Timesheet {
  membershipId: string;
  name: string;
  from: Date;
  to: Date;
  days: DayRow[];
  jobs: JobRow[];
  totalMinutes: number;
  onJobMinutes: number;
  /** The figure that matters: how much of the paid time reached a customer. */
  billablePercent: number;
  costCents: number | null;
  warnings: string[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function timesheet(params: { tenantId: string; membershipId: string; from: Date; to: Date }): Promise<Timesheet> {
  const membership = await prisma.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!membership) throw new Error("That person is not on this workspace.");

  const entries = await prisma.timeEntry.findMany({
    where: { tenantId: params.tenantId, membershipId: params.membershipId, clockInAt: { gte: params.from, lte: params.to } },
    include: { jobCard: { select: { id: true, title: true } } },
    orderBy: { clockInAt: "asc" },
  });

  const days = new Map<string, DayRow>();
  const jobs = new Map<string, JobRow>();
  let total = 0;
  let onJobs = 0;
  let open = 0;

  for (const entry of entries) {
    const key = dayKey(entry.clockInAt);
    const row = days.get(key) ?? { date: key, minutes: 0, onJobs: 0, openShifts: 0 };

    if (!entry.clockOutAt) {
      // Never invented. A shift with no end is a missing fact, and filling it
      // in with eight hours would inflate every cost figure downstream.
      row.openShifts += 1;
      open += 1;
      days.set(key, row);
      continue;
    }

    const minutes = Math.max(0, Math.round((entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 60_000));
    row.minutes += minutes;
    total += minutes;

    if (entry.jobCardId) {
      row.onJobs += minutes;
      onJobs += minutes;
      const jobKey = entry.jobCardId;
      const job = jobs.get(jobKey) ?? { jobCardId: jobKey, title: entry.jobCard?.title ?? "Job", minutes: 0, costCents: null };
      job.minutes += minutes;
      jobs.set(jobKey, job);
    } else {
      const jobKey = "none";
      const job = jobs.get(jobKey) ?? { jobCardId: null, title: "Not on a job", minutes: 0, costCents: null };
      job.minutes += minutes;
      jobs.set(jobKey, job);
    }

    days.set(key, row);
  }

  const rate = membership.costRateCents;
  const costFor = (minutes: number) => (rate ? Math.round((minutes / 60) * rate) : null);

  const warnings: string[] = [];
  if (open > 0) {
    warnings.push(
      `${open} ${open === 1 ? "shift was" : "shifts were"} started and never closed, so ${open === 1 ? "it counts" : "they count"} as no hours at all. Somebody has to say when ${open === 1 ? "it" : "they"} ended.`,
    );
  }
  if (rate === null) {
    warnings.push("No cost per hour recorded for this person, so the hours cannot be priced. That is the number job margin divides by.");
  }
  if (total > 0 && onJobs === 0) {
    warnings.push("None of this week's hours are against a job, so none of it can be costed to a customer.");
  }

  return {
    membershipId: params.membershipId,
    name: membership.user.name ?? membership.user.email ?? "Unnamed",
    from: params.from,
    to: params.to,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    jobs: [...jobs.values()].map((job) => ({ ...job, costCents: costFor(job.minutes) })).sort((a, b) => b.minutes - a.minutes),
    totalMinutes: total,
    onJobMinutes: onJobs,
    billablePercent: total > 0 ? Math.round((onJobs / total) * 100) : 0,
    costCents: costFor(total),
    warnings,
  };
}

/**
 * The whole team's week, in one figure each.
 *
 * Sorted by the share of time that reached a customer rather than by hours,
 * because the person working the longest is rarely the one worth looking at.
 */
export async function teamWeek(params: { tenantId: string; from: Date; to: Date }) {
  const members = await prisma.membership.findMany({
    where: { tenantId: params.tenantId },
    select: { id: true },
  });

  const sheets: Timesheet[] = [];
  for (const member of members) {
    sheets.push(await timesheet({ tenantId: params.tenantId, membershipId: member.id, from: params.from, to: params.to }));
  }

  const worked = sheets.filter((sheet) => sheet.totalMinutes > 0 || sheet.warnings.length > 0);
  worked.sort((a, b) => a.billablePercent - b.billablePercent);

  const totalMinutes = worked.reduce((sum, sheet) => sum + sheet.totalMinutes, 0);
  const onJobMinutes = worked.reduce((sum, sheet) => sum + sheet.onJobMinutes, 0);
  const openShifts = worked.reduce((sum, sheet) => sum + sheet.days.reduce((inner, day) => inner + day.openShifts, 0), 0);

  return {
    sheets: worked,
    totalHours: Math.round(totalMinutes / 60),
    onJobHours: Math.round(onJobMinutes / 60),
    billablePercent: totalMinutes > 0 ? Math.round((onJobMinutes / totalMinutes) * 100) : 0,
    openShifts,
    note:
      totalMinutes === 0
        ? "Nobody clocked any hours this week."
        : `${Math.round(onJobMinutes / 60)} of ${Math.round(totalMinutes / 60)} hours reached a customer. The rest is real work and real cost — it just cannot be billed to anybody.`,
  };
}
