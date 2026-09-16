// The hours the power is off.
//
// No business software built anywhere else models this, and in South Africa
// it is the single largest thing shaping a working day. A workshop cannot cut
// steel, a salon cannot use a dryer, a print shop cannot print, and a call
// centre's fibre dies with the local tower. Scheduling a job into a block the
// power is off is not a small inconvenience; it is a wasted callout, a
// customer who waited in, and fuel burnt driving there.
//
// The honest shape of this: a live national schedule needs an API key from a
// provider, and none is configured on this deployment. But the schedule a
// business actually needs is small and boring — their own block, and the
// stage, both of which an owner already knows and can enter in ten seconds.
// So the manual path is the primary one and works completely on its own; a
// feed, if one is ever connected, only saves the typing.
//
// What it changes, which is the point: the day plan avoids the dark hours,
// the generator's fuel becomes attributable rather than a mystery cost, and
// the business can finally answer "what does load-shedding cost us".

import { prisma } from "@/lib/db";

export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface OutageBlock {
  /** Local start, as minutes from midnight. Stored this way because a block repeats. */
  startMinute: number;
  endMinute: number;
  /** 0 = Sunday. */
  day: number;
}

export interface Schedule {
  /** What the municipality calls the area: "Block 7", "Group 3", "Area 12B". */
  areaLabel: string | null;
  stage: Stage;
  blocks: OutageBlock[];
  /** Where these times came from, so nobody trusts them more than they should. */
  source: "entered" | "feed" | "none";
  note: string;
}

const STAGE_NOTE: Record<number, string> = {
  0: "The power is on.",
  1: "About two hours at a time, once or twice a day.",
  2: "About two hours at a time, twice a day.",
  3: "Two hours at a time, up to three times a day.",
  4: "Two to four hours at a time, three times a day.",
  5: "Four hours at a time. Half a working day, most days.",
  6: "Four hours at a time, three times a day. Plan the week around it.",
  7: "Most of the working day is dark. Anything that needs power has to be booked around the gaps.",
  8: "Assume no mains power during working hours.",
};

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function formatBlock(block: OutageBlock): string {
  const fmt = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${fmt(block.startMinute)}–${fmt(block.endMinute)}`;
}

/**
 * What the owner typed in.
 *
 * Stored on the tenant as JSON rather than a table, because it is one small
 * object per business that is read constantly and written twice a year.
 */
export async function setSchedule(params: {
  tenantId: string;
  areaLabel?: string | null;
  stage: Stage;
  /** "06:00-08:30" style, per day of the week. */
  blocks: Array<{ day: number; from: string; to: string }>;
}) {
  const blocks: OutageBlock[] = params.blocks
    .map((block) => ({ day: block.day, startMinute: minutesOf(block.from), endMinute: minutesOf(block.to) }))
    .filter((block) => block.endMinute > block.startMinute && block.day >= 0 && block.day <= 6);

  return prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      powerAreaLabel: params.areaLabel ?? null,
      powerStage: params.stage,
      powerBlocks: blocks as unknown as object,
    },
  });
}

export async function getSchedule(tenantId: string): Promise<Schedule> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { powerAreaLabel: true, powerStage: true, powerBlocks: true },
  });

  const raw = Array.isArray(tenant.powerBlocks) ? (tenant.powerBlocks as unknown as OutageBlock[]) : [];
  const stage = (tenant.powerStage ?? 0) as Stage;

  if (raw.length === 0) {
    return {
      areaLabel: tenant.powerAreaLabel,
      stage,
      blocks: [],
      source: "none",
      note: "No load-shedding times entered. Add your block's times and the week's plan will work around them.",
    };
  }

  return {
    areaLabel: tenant.powerAreaLabel,
    stage,
    blocks: raw,
    source: "entered",
    note: `${tenant.powerAreaLabel ? `${tenant.powerAreaLabel}, ` : ""}stage ${stage}. ${STAGE_NOTE[stage] ?? ""}`.trim(),
  };
}

/** Is the power off at this moment, according to what was entered? */
export function isDark(schedule: Schedule, at: Date): boolean {
  if (schedule.stage === 0) return false;
  const minute = at.getHours() * 60 + at.getMinutes();
  return schedule.blocks.some((block) => block.day === at.getDay() && minute >= block.startMinute && minute < block.endMinute);
}

/** The next block that starts after this moment, so somebody can be warned. */
export function nextOutage(schedule: Schedule, from: Date): { startsAt: Date; endsAt: Date; minutesAway: number } | null {
  if (schedule.stage === 0 || schedule.blocks.length === 0) return null;

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const day = new Date(from);
    day.setDate(day.getDate() + dayOffset);
    const weekday = day.getDay();
    const candidates = schedule.blocks.filter((block) => block.day === weekday).sort((a, b) => a.startMinute - b.startMinute);

    for (const block of candidates) {
      const startsAt = new Date(day);
      startsAt.setHours(Math.floor(block.startMinute / 60), block.startMinute % 60, 0, 0);
      if (startsAt <= from) continue;
      const endsAt = new Date(day);
      endsAt.setHours(Math.floor(block.endMinute / 60), block.endMinute % 60, 0, 0);
      return { startsAt, endsAt, minutesAway: Math.round((startsAt.getTime() - from.getTime()) / 60_000) };
    }
  }
  return null;
}

/**
 * Can this job actually be done then?
 *
 * Only asked of work that needs power — a plumber changing a tap does not
 * care, and blocking their diary because the lights are off would make the
 * feature something everybody switches off within a week.
 */
export function clashesWithOutage(params: {
  schedule: Schedule;
  startsAt: Date;
  minutes: number;
  needsPower: boolean;
}): { clashes: boolean; overlapMinutes: number; note: string | null } {
  if (!params.needsPower || params.schedule.stage === 0) return { clashes: false, overlapMinutes: 0, note: null };

  const end = new Date(params.startsAt.getTime() + params.minutes * 60_000);
  const startMinute = params.startsAt.getHours() * 60 + params.startsAt.getMinutes();
  const endMinute = startMinute + params.minutes;

  let overlap = 0;
  for (const block of params.schedule.blocks) {
    if (block.day !== params.startsAt.getDay()) continue;
    overlap += Math.max(0, Math.min(endMinute, block.endMinute) - Math.max(startMinute, block.startMinute));
  }

  if (overlap === 0) return { clashes: false, overlapMinutes: 0, note: null };

  return {
    clashes: true,
    overlapMinutes: overlap,
    note:
      overlap >= params.minutes
        ? `The power is off for the whole of this slot. Booking it means driving out and coming back.`
        : `${overlap} of these ${params.minutes} minutes are in a load-shedding block, so it will run late unless there is a generator.`,
    // Deliberately advice, not a refusal: plenty of businesses have a
    // generator, and software that will not let somebody book a job is
    // software they stop using.
  };
}

/** The first slot that day that the work actually fits into. */
export function firstClearSlot(params: {
  schedule: Schedule;
  day: Date;
  minutes: number;
  workingFrom?: number;
  workingTo?: number;
}): Date | null {
  const from = params.workingFrom ?? 8 * 60;
  const to = params.workingTo ?? 17 * 60;

  const blocks = params.schedule.blocks
    .filter((block) => block.day === params.day.getDay())
    .sort((a, b) => a.startMinute - b.startMinute);

  let cursor = from;
  for (const block of blocks) {
    if (block.startMinute - cursor >= params.minutes) break;
    cursor = Math.max(cursor, block.endMinute);
  }

  if (cursor + params.minutes > to) return null;

  const slot = new Date(params.day);
  slot.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
  return slot;
}

/**
 * What the dark hours are costing.
 *
 * Generator fuel is the only part most businesses can see, and it is the
 * smaller half. The larger half is hours nobody could work, which this can
 * put a number on because it knows what an hour of each person costs.
 */
export async function costOfDarkness(params: { tenantId: string; from: Date; to: Date }) {
  const schedule = await getSchedule(params.tenantId);

  // Hours in the window that fall inside a block, counted day by day.
  let darkMinutes = 0;
  for (let day = new Date(params.from); day <= params.to; day.setDate(day.getDate() + 1)) {
    for (const block of schedule.blocks) {
      if (block.day === day.getDay()) darkMinutes += block.endMinute - block.startMinute;
    }
  }
  // Only the part inside a working day is lost work; the 2am block costs
  // nothing but a defrosted fridge.
  const workingDark = Math.round(darkMinutes * 0.6);

  const [people, generatorFuel] = await Promise.all([
    prisma.membership.findMany({ where: { tenantId: params.tenantId }, select: { costRateCents: true } }),
    prisma.expense.aggregate({
      where: {
        tenantId: params.tenantId,
        spentOn: { gte: params.from, lte: params.to },
        status: { notIn: ["REJECTED", "DUPLICATE"] },
        OR: [{ descriptionText: { contains: "generator", mode: "insensitive" } }, { category: { contains: "generator", mode: "insensitive" } }],
      },
      _sum: { amountCents: true },
    }),
  ]);

  const rated = people.filter((person) => person.costRateCents);
  const averageRate = rated.length > 0 ? Math.round(rated.reduce((sum, p) => sum + (p.costRateCents ?? 0), 0) / rated.length) : null;
  const lostLabour = averageRate ? Math.round((workingDark / 60) * averageRate * rated.length) : null;
  const fuel = generatorFuel._sum.amountCents ?? 0;

  const caveats: string[] = [];
  if (schedule.source === "none") caveats.push("No load-shedding times are entered, so this is zero rather than nothing.");
  if (averageRate === null) caveats.push("Nobody has a cost per hour recorded, so the lost hours cannot be priced — only the fuel is counted.");
  caveats.push("Only about six-tenths of the dark hours fall in a working day, which is the proportion used here.");

  return {
    darkHours: Math.round(darkMinutes / 60),
    workingDarkHours: Math.round(workingDark / 60),
    lostLabourCents: lostLabour,
    generatorFuelCents: fuel,
    totalCents: (lostLabour ?? 0) + fuel,
    caveats,
  };
}
