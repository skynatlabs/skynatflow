// The screen somebody uses standing up.
//
// Every other page here assumes a desk: a person sitting down, with a mouse,
// with signal, with time to read. Field mode assumes none of that. It is for
// the technician on a roof, the driver at a gate, the installer in a ceiling
// — one thumb, bright sunlight, and a bar of signal that comes and goes.
//
// Which changes what belongs on it. Not "everything, smaller": today's work
// and nothing else, each item one tap from the two or three things that
// actually happen to it, and every one of those actions written to the queue
// first so it survives a tunnel. The dashboard is a place to look things up;
// this is a place to record what happened while it is happening, which is the
// only time anybody will ever record it accurately.

import { prisma } from "@/lib/db";
import { enqueue, queueHealth, type ChangeKind } from "./offlineQueue";

export interface FieldJob {
  id: string;
  title: string;
  customer: string;
  /** Where, in the form somebody navigates to. */
  where: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  scheduledAt: Date | null;
  status: string;
  /** Minutes, when anybody estimated. */
  expected: number | null;
  /** What has to be done and photographed before this can be closed. */
  checklistOutstanding: number;
  /** Whether they are clocked on to it right now. */
  onIt: boolean;
  /** The two or three things that actually happen next. */
  actions: Array<{ key: string; label: string }>;
}

/**
 * Today, for one person.
 *
 * Deliberately not "their jobs": jobs scheduled for today, plus anything
 * still open from yesterday that nobody closed — because the thing a
 * technician most often needs is the job they did not finish, and a list that
 * quietly drops it at midnight is a list that loses work.
 */
export async function todayInTheField(params: { tenantId: string; membershipId: string; now?: Date }): Promise<{
  jobs: FieldJob[];
  queued: number;
  stuck: number;
  greeting: string;
}> {
  const now = params.now ?? new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);

  const [jobs, openShift, health] = await Promise.all([
    prisma.jobCard.findMany({
      where: {
        tenantId: params.tenantId,
        assignedToId: params.membershipId,
        status: { not: "DONE" },
        OR: [{ scheduledAt: { gte: start, lt: end } }, { scheduledAt: { lt: start } }, { scheduledAt: null, status: "IN_PROGRESS" }],
      },
      orderBy: [{ routeOrder: "asc" }, { scheduledAt: "asc" }],
      include: {
        party: { select: { name: true, companyName: true, phone: true, addressLine: true } },
        checklist: { include: { items: true } },
      },
      take: 40,
    }),
    prisma.timeEntry.findFirst({
      where: { tenantId: params.tenantId, membershipId: params.membershipId, clockOutAt: null },
      select: { jobCardId: true },
    }),
    queueHealth(params.tenantId),
  ]);

  const rows: FieldJob[] = jobs.map((job) => {
    const onIt = openShift?.jobCardId === job.id;
    const outstanding = job.checklist?.items.length ?? 0;

    // Two or three, never a menu. A person holding a phone one-handed on a
    // ladder will use the first button and nothing else.
    const actions: Array<{ key: string; label: string }> = [];
    if (!onIt && job.status !== "DONE") actions.push({ key: "start", label: "Start" });
    if (onIt) actions.push({ key: "stop", label: "Stop" });
    if (onIt || job.status === "IN_PROGRESS") actions.push({ key: "photo", label: "Photo" });
    if (onIt || job.status === "IN_PROGRESS") actions.push({ key: "done", label: "Finished" });
    if (job.party?.phone) actions.push({ key: "call", label: "Call" });

    return {
      id: job.id,
      title: job.title ?? "Job",
      customer: job.party?.companyName ?? job.party?.name ?? "No customer",
      where: job.siteAddress ?? job.party?.addressLine ?? null,
      lat: job.siteLat,
      lng: job.siteLng,
      phone: job.party?.phone ?? null,
      scheduledAt: job.scheduledAt,
      status: job.status,
      expected: job.estimatedMinutes,
      checklistOutstanding: outstanding,
      onIt,
      actions,
    };
  });

  const hour = now.getHours();
  const greeting =
    rows.length === 0
      ? "Nothing on for today."
      : `${rows.length} ${rows.length === 1 ? "job" : "jobs"}${hour < 12 ? " today" : " left"}.${rows.some((row) => row.onIt) ? " You are clocked on to one of them." : ""}`;

  return { jobs: rows, queued: health.pending, stuck: health.failed, greeting };
}

/**
 * Record something that happened, whether or not there is signal.
 *
 * Everything from this screen goes through the queue rather than straight to
 * the database, and it is not a fallback for when the network fails — it is
 * the only path. A write that sometimes goes direct and sometimes queues has
 * two orderings, and the bug that produces only shows up on a bad day at a
 * customer's site.
 */
export async function recordInTheField(params: {
  tenantId: string;
  membershipId: string;
  jobCardId: string;
  action: "start" | "stop" | "photo" | "note" | "done";
  /** The moment it happened, which is not the moment it syncs. */
  at: Date;
  /** A stable id from the device, so a retry is not a second record. */
  clientRef: string;
  payload?: Record<string, unknown>;
}) {
  // Mapped onto the kinds the queue already knows how to apply, rather than
  // inventing new ones: a photograph is a cost capture with a picture on it,
  // and finishing a job is a status change. A second vocabulary here would be
  // a second thing to keep in step with the applier.
  const kind: ChangeKind =
    params.action === "start"
      ? "time.clockOn"
      : params.action === "stop"
        ? "time.clockOff"
        : params.action === "photo"
          ? "expense.capture"
          : params.action === "done"
            ? "job.status"
            : "note.add";

  return enqueue({
    tenantId: params.tenantId,
    membershipId: params.membershipId,
    changes: [
      {
        kind,
        clientRef: params.clientRef,
        happenedAt: params.at.toISOString(),
        payload: {
          jobCardId: params.jobCardId,
          ...(params.action === "done" ? { status: "DONE" } : {}),
          ...(params.payload ?? {}),
        },
      },
    ],
  });
}

/** A link the phone's own map app will open. */
export function directionsTo(job: Pick<FieldJob, "lat" | "lng" | "where">): string | null {
  if (job.lat !== null && job.lng !== null) return `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`;
  if (job.where) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.where)}`;
  return null;
}
