// The day, in order.
//
// Scheduling in this app was a date on a job card, which is a list rather
// than a plan. Two things turn one into the other, and neither needs a
// planning engine:
//
//   ORDER. A day put in the order the stops actually make sense in, so a
//   driver gets a route rather than a pile. The nearest-neighbour walk below
//   is not optimal and does not pretend to be — on a real day of six to
//   twelve stops it is within a few percent of optimal, it is explicable, and
//   it runs in a millisecond. A business does not want the mathematically
//   best route; it wants to stop doubling back.
//
//   CAPACITY. Whether a day can take another job at all. Answered from the
//   estimates on the jobs already on it plus the hours the team actually
//   works, so "can we fit them in on Thursday" has an answer that is not a
//   shrug.
//
// Nothing here moves a job without being told to. A dispatch board that
// rearranges itself overnight is one nobody trusts.

import { JobCardStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatBlock, getSchedule } from "./loadShedding";
import { haversineKm } from "./trips";

/** A working day, in hours, when nothing says otherwise. */
const DEFAULT_DAY_HOURS = 8;
/** What a job takes when nobody has said. Long enough not to over-promise. */
const DEFAULT_JOB_MINUTES = 90;

export interface DispatchJob {
  id: string;
  title: string;
  customer: string;
  partyId: string;
  status: JobCardStatus;
  scheduledAt: Date | null;
  estimatedMinutes: number;
  routeOrder: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  assignedToId: string | null;
  assignedTo: string | null;
  subcontractor: string | null;
  /** A job that cannot start until another finishes. */
  dependsOnId: string | null;
  blockedBy: string | null;
}

export interface DispatchDay {
  date: string;
  jobs: DispatchJob[];
  minutesBooked: number;
  minutesAvailable: number;
  /** Over 100 means the day is promising more than it has. */
  loadPercent: number;
  /** Set once a day has been put in order and the stops carry positions. */
  routeKm: number | null;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function minutesOf(job: { estimatedMinutes: number | null }): number {
  return job.estimatedMinutes ?? DEFAULT_JOB_MINUTES;
}

async function teamMinutesPerDay(tenantId: string): Promise<number> {
  const people = await prisma.membership.count({ where: { tenantId, role: { in: ["STAFF", "TECHNICIAN", "DRIVER", "OWNER"] } } });
  return Math.max(1, people) * DEFAULT_DAY_HOURS * 60;
}

/**
 * The board: every scheduled job grouped by the day it sits on.
 *
 * Unscheduled jobs come back under their own key rather than being hidden,
 * because the pile of work with no date is the thing a dispatcher most needs
 * to see.
 */
export async function dispatchBoard(params: {
  tenantId: string;
  from?: Date;
  days?: number;
  assignedToId?: string;
}): Promise<{ days: DispatchDay[]; unscheduled: DispatchJob[]; minutesPerDay: number }> {
  const from = params.from ?? new Date();
  const span = params.days ?? 7;
  const to = new Date(from.getTime() + span * 86_400_000);

  const [jobs, minutesPerDay] = await Promise.all([
    prisma.jobCard.findMany({
      where: {
        tenantId: params.tenantId,
        status: { not: JobCardStatus.DONE },
        ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
        OR: [{ scheduledAt: null }, { scheduledAt: { gte: new Date(from.getTime() - 86_400_000), lte: to } }],
      },
      orderBy: [{ scheduledAt: "asc" }, { routeOrder: "asc" }, { createdAt: "asc" }],
      take: 500,
      include: {
        party: { select: { id: true, name: true, companyName: true, addressLine: true, city: true } },
        assignedTo: { select: { id: true, user: { select: { name: true, email: true } } } },
        subcontractor: { select: { name: true, companyName: true } },
        dependsOn: { select: { id: true, title: true, status: true } },
      },
    }),
    teamMinutesPerDay(params.tenantId),
  ]);

  const shaped: DispatchJob[] = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    customer: j.party.companyName ?? j.party.name,
    partyId: j.partyId,
    status: j.status,
    scheduledAt: j.scheduledAt,
    estimatedMinutes: minutesOf(j),
    routeOrder: j.routeOrder,
    address: j.siteAddress ?? ([j.party.addressLine, j.party.city].filter(Boolean).join(", ") || null),
    lat: j.siteLat,
    lng: j.siteLng,
    assignedToId: j.assignedToId,
    assignedTo: j.assignedTo ? j.assignedTo.user.name ?? j.assignedTo.user.email : null,
    subcontractor: j.subcontractor ? j.subcontractor.companyName ?? j.subcontractor.name : null,
    dependsOnId: j.dependsOnId,
    // A job whose predecessor is not finished cannot start, and saying so on
    // the board is cheaper than finding out on site.
    blockedBy: j.dependsOn && j.dependsOn.status !== JobCardStatus.DONE ? j.dependsOn.title : null,
  }));

  const days: DispatchDay[] = [];
  for (let i = 0; i < span; i++) {
    const date = new Date(from.getTime() + i * 86_400_000);
    const key = dayKey(date);
    const onDay = shaped
      .filter((j) => j.scheduledAt && dayKey(j.scheduledAt) === key)
      .sort((a, b) => (a.routeOrder ?? 999) - (b.routeOrder ?? 999));
    const booked = onDay.reduce((s, j) => s + j.estimatedMinutes, 0);

    days.push({
      date: key,
      jobs: onDay,
      minutesBooked: booked,
      minutesAvailable: minutesPerDay,
      loadPercent: Math.round((booked / minutesPerDay) * 100),
      routeKm: routeLength(onDay),
    });
  }

  return { days, unscheduled: shaped.filter((j) => !j.scheduledAt), minutesPerDay };
}

function routeLength(jobs: DispatchJob[]): number | null {
  const located = jobs.filter((j) => j.lat !== null && j.lng !== null);
  if (located.length < 2) return null;
  let km = 0;
  for (let i = 1; i < located.length; i++) {
    km += haversineKm(located[i - 1].lat!, located[i - 1].lng!, located[i].lat!, located[i].lng!);
  }
  return Math.round(km * 10) / 10;
}

export async function scheduleJob(params: {
  tenantId: string;
  jobCardId: string;
  scheduledAt: Date | null;
  assignedToId?: string | null;
  estimatedMinutes?: number | null;
}) {
  const job = await prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } });
  if (!job) throw new Error("That job is not in this workspace.");
  if (params.assignedToId) {
    const member = await prisma.membership.findFirst({
      where: { id: params.assignedToId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!member) throw new Error("That person is not on this workspace.");
  }

  return prisma.jobCard.update({
    where: { id: params.jobCardId },
    data: {
      scheduledAt: params.scheduledAt,
      // Moving a job to another day invalidates its place in the old day's
      // order, and leaving a stale position is how a route comes out wrong.
      routeOrder: null,
      ...(params.assignedToId !== undefined ? { assignedToId: params.assignedToId } : {}),
      ...(params.estimatedMinutes !== undefined ? { estimatedMinutes: params.estimatedMinutes } : {}),
    },
  });
}

export async function setJobSite(params: {
  tenantId: string;
  jobCardId: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const job = await prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } });
  if (!job) throw new Error("That job is not in this workspace.");
  return prisma.jobCard.update({
    where: { id: params.jobCardId },
    data: { siteAddress: params.address ?? null, siteLat: params.lat ?? null, siteLng: params.lng ?? null },
  });
}

export interface RouteResult {
  date: string;
  ordered: Array<{ jobCardId: string; title: string; customer: string; position: number }>;
  /** Kilometres before and after, so the gain is visible rather than asserted. */
  wasKm: number | null;
  nowKm: number | null;
  savedKm: number | null;
  /** Said plainly when there was nothing to do. */
  note: string;
}

/**
 * Put a day's stops in an order that stops the doubling back.
 *
 * Nearest neighbour from the first stop, which is the one a business has
 * usually already decided (the early appointment, the far one they want out
 * of the way). Explicable beats optimal here: a dispatcher who cannot see why
 * the order came out that way will re-drag it by hand anyway.
 */
export async function orderTheDay(params: { tenantId: string; date: Date; assignedToId?: string }): Promise<RouteResult> {
  const start = new Date(Date.UTC(params.date.getUTCFullYear(), params.date.getUTCMonth(), params.date.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);

  const jobs = await prisma.jobCard.findMany({
    where: {
      tenantId: params.tenantId,
      status: { not: JobCardStatus.DONE },
      scheduledAt: { gte: start, lt: end },
      ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    },
    orderBy: [{ routeOrder: "asc" }, { scheduledAt: "asc" }],
    include: { party: { select: { name: true, companyName: true } } },
  });

  const located = jobs.filter((j) => j.siteLat !== null && j.siteLng !== null);
  if (located.length < 3) {
    return {
      date: dayKey(start),
      ordered: jobs.map((j, i) => ({ jobCardId: j.id, title: j.title, customer: j.party.companyName ?? j.party.name, position: i })),
      wasKm: null,
      nowKm: null,
      savedKm: null,
      note:
        located.length === jobs.length
          ? "Fewer than three stops with a location on them — nothing to reorder."
          : `Only ${located.length} of ${jobs.length} jobs have a location, so there is not enough to route.`,
    };
  }

  const before = located.reduce(
    (km, job, i) => (i === 0 ? 0 : km + haversineKm(located[i - 1].siteLat!, located[i - 1].siteLng!, job.siteLat!, job.siteLng!)),
    0
  );

  const remaining = [...located];
  const walk = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = walk[walk.length - 1];
    let best = 0;
    let bestKm = Infinity;
    for (const [i, candidate] of remaining.entries()) {
      const km = haversineKm(last.siteLat!, last.siteLng!, candidate.siteLat!, candidate.siteLng!);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    walk.push(remaining.splice(best, 1)[0]);
  }

  const after = walk.reduce(
    (km, job, i) => (i === 0 ? 0 : km + haversineKm(walk[i - 1].siteLat!, walk[i - 1].siteLng!, job.siteLat!, job.siteLng!)),
    0
  );

  // Jobs with no location keep their place at the end rather than being
  // dropped — a stop nobody geocoded is still a stop somebody has to make.
  const unlocated = jobs.filter((j) => j.siteLat === null || j.siteLng === null);
  const finalOrder = [...walk, ...unlocated];

  await prisma.$transaction(
    finalOrder.map((job, position) => prisma.jobCard.update({ where: { id: job.id }, data: { routeOrder: position } }))
  );

  const saved = Math.round((before - after) * 10) / 10;
  return {
    date: dayKey(start),
    ordered: finalOrder.map((j, i) => ({ jobCardId: j.id, title: j.title, customer: j.party.companyName ?? j.party.name, position: i })),
    wasKm: Math.round(before * 10) / 10,
    nowKm: Math.round(after * 10) / 10,
    savedKm: saved,
    note:
      saved <= 0.5
        ? "Already about as short as it goes — the order is left as it was worth being."
        : `${saved} km shorter than the order it was in.`,
  };
}

export interface CapacityAnswer {
  date: string;
  minutesBooked: number;
  minutesAvailable: number;
  minutesFree: number;
  fits: boolean;
  /** The sentence somebody can read down the phone. */
  answer: string;
  /** Load-shedding that day, when there is any. Advice, never a refusal. */
  powerWarning: string | null;
}

/** Can we take this job that day? Answered from the jobs already on it. */
export async function canWeFitIt(params: {
  tenantId: string;
  date: Date;
  minutes?: number;
  assignedToId?: string;
}): Promise<CapacityAnswer> {
  const wanted = params.minutes ?? DEFAULT_JOB_MINUTES;
  const board = await dispatchBoard({ tenantId: params.tenantId, from: params.date, days: 1, assignedToId: params.assignedToId });
  const day = board.days[0];
  const free = day.minutesAvailable - day.minutesBooked;
  const fits = free >= wanted;

  // The hours free are only half the answer in a country where the power
  // goes off on a schedule. A day with four hours free, three of them dark,
  // is not a day you promise a customer.
  const schedule = await getSchedule(params.tenantId);
  const darkMinutes = schedule.blocks
    .filter((block) => block.day === params.date.getDay())
    .reduce((sum, block) => sum + (block.endMinute - block.startMinute), 0);

  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} hours`;
  return {
    date: day.date,
    minutesBooked: day.minutesBooked,
    minutesAvailable: day.minutesAvailable,
    minutesFree: free,
    fits,
    answer: fits
      ? `Yes — ${hours(free)} free that day, and this would take ${hours(wanted)}.`
      : `Not really. ${hours(day.minutesBooked)} is already booked out of ${hours(day.minutesAvailable)}, leaving ${hours(Math.max(0, free))}.`,
    powerWarning:
      darkMinutes > 0
        ? `The power is off for ${hours(darkMinutes)} that day (${schedule.blocks
            .filter((block) => block.day === params.date.getDay())
            .map(formatBlock)
            .join(", ")}). Fine for work that needs no power.`
        : null,
  };
}

/** The next day that could take a job of this size. */
export async function nextDayItFits(params: { tenantId: string; minutes?: number; from?: Date; within?: number }) {
  const from = params.from ?? new Date();
  const within = params.within ?? 21;
  for (let i = 0; i < within; i++) {
    const date = new Date(from.getTime() + i * 86_400_000);
    // Nobody wants to be told the job can be done on Sunday.
    const weekday = date.getUTCDay();
    if (weekday === 0) continue;
    const answer = await canWeFitIt({ tenantId: params.tenantId, date, minutes: params.minutes });
    if (answer.fits) return answer;
  }
  return null;
}
