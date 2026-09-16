// What has to happen before what.
//
// This is the one view people name when they leave for Monday or ClickUp: a
// bar per job, in time order, with a line showing that the second cannot
// start until the first is finished. It looks decorative and it is not — the
// thing it makes visible is the chain, and the chain is where a project
// quietly slips a fortnight because nobody noticed that one late job pushes
// four others.
//
// Computed rather than drawn: the dependency is already on the job card, and
// what has been missing is the arithmetic that turns a set of dependencies
// into dates, a critical path and an honest answer to "when will this
// finish".

import { prisma } from "@/lib/db";

const DEFAULT_MINUTES = 120;

export interface Bar {
  id: string;
  title: string;
  customer: string;
  /** When it can start, given everything it waits on. */
  startsAt: Date;
  endsAt: Date;
  minutes: number;
  status: string;
  dependsOnId: string | null;
  /** Whether a day's slip here slips the whole project. */
  onCriticalPath: boolean;
  /** How much it could slip before anything else moves. Minutes. */
  slackMinutes: number;
  /** Set when this cannot start when it is scheduled to. */
  problem: string | null;
}

export interface Chain {
  bars: Bar[];
  from: Date;
  to: Date;
  /** The longest chain — what actually decides the finish date. */
  criticalPath: string[];
  finishesAt: Date | null;
  note: string;
  warnings: string[];
}

/**
 * Lay the jobs out in time.
 *
 * Forward pass for the earliest each job can start, backward pass for how
 * much slack each has. The arithmetic is ordinary critical-path method; what
 * matters here is that it refuses to produce a plan from a broken graph
 * rather than silently drawing something wrong.
 */
export async function chain(params: { tenantId: string; from?: Date; days?: number }): Promise<Chain> {
  const from = params.from ?? new Date();
  const to = new Date(from.getTime() + (params.days ?? 60) * 86_400_000);

  const jobs = await prisma.jobCard.findMany({
    where: {
      tenantId: params.tenantId,
      status: { not: "DONE" },
      OR: [{ scheduledAt: { gte: from, lte: to } }, { scheduledAt: null }],
    },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      estimatedMinutes: true,
      dependsOnId: true,
      party: { select: { name: true, companyName: true } },
    },
    take: 300,
  });

  const byId = new Map(jobs.map((job) => [job.id, job]));
  const warnings: string[] = [];

  // A cycle is a plan that cannot happen, and drawing one produces a chart
  // that loops for ever. Broken here, loudly, rather than rendered.
  const inCycle = new Set<string>();
  for (const job of jobs) {
    const seen = new Set<string>([job.id]);
    let cursor = job.dependsOnId;
    while (cursor) {
      if (seen.has(cursor)) {
        inCycle.add(job.id);
        warnings.push(`"${job.title}" waits on something that waits on it. That cannot happen, so the chain is shown without it.`);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.dependsOnId ?? null;
    }
  }

  const usable = jobs.filter((job) => !inCycle.has(job.id));
  const minutesOf = (job: (typeof jobs)[number]) => job.estimatedMinutes ?? DEFAULT_MINUTES;

  // Forward pass. A job with no dependency starts when it is scheduled, or
  // now if nobody scheduled it.
  const earliest = new Map<string, Date>();
  const resolve = (id: string, depth = 0): Date => {
    if (earliest.has(id)) return earliest.get(id)!;
    // The cycle check above should make this unreachable; belt and braces,
    // because an infinite recursion here takes the page down.
    if (depth > 100) return from;

    const job = byId.get(id);
    if (!job) return from;

    const own = job.scheduledAt && job.scheduledAt > from ? job.scheduledAt : from;
    let start = own;

    if (job.dependsOnId) {
      const parent = byId.get(job.dependsOnId);
      if (parent && !inCycle.has(parent.id)) {
        const parentEnd = new Date(resolve(parent.id, depth + 1).getTime() + minutesOf(parent) * 60_000);
        if (parentEnd > start) start = parentEnd;
      }
    }

    earliest.set(id, start);
    return start;
  };

  for (const job of usable) resolve(job.id);

  const bars: Bar[] = usable.map((job) => {
    const startsAt = earliest.get(job.id) ?? from;
    const minutes = minutesOf(job);
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

    // A job whose earliest possible start is after the day somebody promised
    // it. This is the thing nobody notices until a customer phones.
    const problem =
      job.scheduledAt && startsAt.getTime() > job.scheduledAt.getTime() + 60_000
        ? `Scheduled for ${job.scheduledAt.toLocaleDateString()}, but cannot start until ${startsAt.toLocaleDateString()} because of what it waits on.`
        : job.estimatedMinutes === null
          ? "No estimate, so this is drawn as two hours. Every date after it is a guess until somebody says how long it takes."
          : null;

    return {
      id: job.id,
      title: job.title,
      customer: job.party?.companyName ?? job.party?.name ?? "No customer",
      startsAt,
      endsAt,
      minutes,
      status: job.status,
      dependsOnId: job.dependsOnId,
      onCriticalPath: false,
      slackMinutes: 0,
      problem,
    };
  });

  // Backward pass, in the simple form this needs: the critical path is the
  // longest chain of dependencies, and everything on it has no slack.
  const lengthTo = new Map<string, number>();
  const chainOf = (id: string, depth = 0): string[] => {
    if (depth > 100) return [id];
    const job = byId.get(id);
    if (!job?.dependsOnId || inCycle.has(job.dependsOnId)) return [id];
    return [...chainOf(job.dependsOnId, depth + 1), id];
  };

  let longest: string[] = [];
  for (const bar of bars) {
    const path = chainOf(bar.id);
    const total = path.reduce((sum, id) => sum + (byId.get(id) ? minutesOf(byId.get(id)!) : 0), 0);
    lengthTo.set(bar.id, total);
    if (path.length > longest.length || (path.length === longest.length && total > 0)) {
      if (path.length > longest.length) longest = path;
    }
  }

  const critical = new Set(longest);
  const finish = bars.length > 0 ? new Date(Math.max(...bars.map((bar) => bar.endsAt.getTime()))) : null;

  for (const bar of bars) {
    bar.onCriticalPath = critical.has(bar.id);
    // Slack is how long this could slip before it becomes the thing that
    // decides the finish date.
    bar.slackMinutes = bar.onCriticalPath || !finish ? 0 : Math.max(0, Math.round((finish.getTime() - bar.endsAt.getTime()) / 60_000));
  }

  bars.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const noEstimate = bars.filter((bar) => bar.problem?.startsWith("No estimate")).length;
  if (noEstimate > 0) {
    warnings.push(`${noEstimate} ${noEstimate === 1 ? "job has" : "jobs have"} no estimate, so every date after ${noEstimate === 1 ? "it" : "them"} is a guess.`);
  }
  const late = bars.filter((bar) => bar.problem?.startsWith("Scheduled for")).length;
  if (late > 0) {
    warnings.push(`${late} ${late === 1 ? "job is" : "jobs are"} promised for a day ${late === 1 ? "it" : "they"} cannot start on.`);
  }

  return {
    bars,
    from,
    to,
    criticalPath: longest,
    finishesAt: finish,
    note:
      bars.length === 0
        ? "Nothing open in this window."
        : longest.length > 1
          ? `${bars.length} ${bars.length === 1 ? "job" : "jobs"}. ${longest.length} of them form a chain — a day lost on any of those is a day lost on the finish date.`
          : `${bars.length} ${bars.length === 1 ? "job" : "jobs"}, none of them waiting on each other.`,
    warnings,
  };
}

/** Make one job wait for another, refusing anything that could not happen. */
export async function dependsOn(params: { tenantId: string; jobCardId: string; waitsForId: string | null }) {
  const job = await prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } });
  if (!job) throw new Error("That job is not in this workspace.");

  if (params.waitsForId === null) {
    return prisma.jobCard.update({ where: { id: job.id }, data: { dependsOnId: null } });
  }

  if (params.waitsForId === params.jobCardId) throw new Error("A job cannot wait for itself.");

  const parent = await prisma.jobCard.findFirst({ where: { id: params.waitsForId, tenantId: params.tenantId }, select: { id: true } });
  if (!parent) throw new Error("The job it would wait for is not in this workspace.");

  // Walk up from the proposed parent: if this job is anywhere above it, the
  // link would make a loop. Refused here rather than discovered by a chart
  // that never stops drawing.
  const all = await prisma.jobCard.findMany({ where: { tenantId: params.tenantId }, select: { id: true, dependsOnId: true } });
  const parents = new Map(all.map((row) => [row.id, row.dependsOnId]));
  let cursor: string | null | undefined = params.waitsForId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === params.jobCardId) throw new Error("That would make a loop — the other job already waits on this one, directly or through another.");
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = parents.get(cursor);
  }

  return prisma.jobCard.update({ where: { id: job.id }, data: { dependsOnId: params.waitsForId } });
}
