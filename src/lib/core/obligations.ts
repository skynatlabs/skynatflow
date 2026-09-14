// Obligations — the dated things this business owes somebody else.
//
// The point of this module is not a list of dates. It is that the agent can
// see, in one query, everything capable of stopping the business: a CIPC
// annual return nobody diarised, a Letter of Good Standing that went stale
// three weeks before the tender, a driver's PDP that expired yesterday, the
// notice window on an auto-renewing supplier contract closing on Friday.
//
// Three ideas do most of the work here:
//
//  1. ACTION-BY, NOT DUE. On an auto-renewing contract the date that
//     matters is the last day you can give notice, not the renewal date —
//     by the renewal date the decision has been made for you. Every read
//     path sorts and warns on actionByAt.
//
//  2. THE CONSEQUENCE IS STORED, NOT INFERRED. "Miss this and the company
//     is deregistered and the bank account freezes" is the whole reason
//     anyone acts. It lives on the row so the agent quotes it rather than
//     inventing a reason the thing matters.
//
//  3. SOME OF THESE ARE GUARDRAILS, NOT REMINDERS. blocksWork turns an
//     obligation from advice into a refusal: assertNotBlocked() is called
//     by the code that dispatches people and vehicles, so an expired PDP
//     stops the dispatch instead of decorating a dashboard.

import { prisma } from "@/lib/db";
import {
  ObligationKind,
  ObligationRecurrence,
  ObligationSeverity,
  ObligationStatus,
  type Obligation,
} from "@prisma/client";

/** Where the business is, for day-boundary purposes. Same default as the agent's scheduler. */
export const OBLIGATION_TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Johannesburg";

// ------------------------------------------------------------------ dates
//
// Everything here is calendar-day arithmetic, never 24-hour arithmetic. A
// renewal due "in 3 days" has to mean three sleeps to the person reading
// it, which is a question about local dates and not about elapsed hours —
// and toISOString() answers it wrongly for every timezone east of UTC.

interface Ymd {
  y: number;
  m: number;
  d: number;
}

// One formatter per zone, kept. Building one costs enough that doing it per
// row turns a radar over a few hundred obligations into visible latency.
const YMD_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = YMD_FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    YMD_FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

function ymdIn(date: Date, timeZone = OBLIGATION_TIMEZONE): Ymd {
  const parts = ymdFormatter(timeZone).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Days from `from` to `to`, counted as local calendar days. Negative = in the past. */
export function daysBetween(from: Date, to: Date, timeZone = OBLIGATION_TIMEZONE): number {
  const a = ymdIn(from, timeZone);
  const b = ymdIn(to, timeZone);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

const MONTHS_PER: Record<ObligationRecurrence, number> = {
  NONE: 0,
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  BIANNUAL: 6,
  ANNUAL: 12,
};

/**
 * The next occurrence after `from`.
 *
 * Clamps to the end of the target month, so a 31 January obligation recurring
 * monthly lands on 28 (or 29) February rather than silently rolling into
 * March and losing a period — which would quietly skip a VAT return.
 */
export function advanceRecurrence(from: Date, recurrence: ObligationRecurrence): Date | null {
  const months = MONTHS_PER[recurrence];
  if (!months) return null;

  const { y, m, d } = ymdIn(from);
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(d, lastDay), 12, 0, 0));
}

/**
 * The date a human actually has to act by.
 *
 * For anything with a notice window this is earlier than the due date, and
 * it is the only date worth warning about — an auto-renewing contract whose
 * notice window closed has already renewed.
 */
export function actionByDate(o: Pick<Obligation, "dueAt" | "noticeDays">): Date {
  if (!o.noticeDays) return o.dueAt;
  return new Date(o.dueAt.getTime() - o.noticeDays * 86_400_000);
}

// ------------------------------------------------------------------ radar

export type ObligationState = "OVERDUE" | "DUE" | "SOON" | "SCHEDULED";

export interface RadarLine {
  id: string;
  kind: ObligationKind;
  title: string;
  authority: string | null;
  reference: string | null;
  dueAt: Date;
  /** The date to act by — earlier than dueAt wherever a notice window applies. */
  actionByAt: Date;
  daysUntil: number;
  severity: ObligationSeverity;
  state: ObligationState;
  consequence: string | null;
  blocksWork: boolean;
  recurrence: ObligationRecurrence;
  subject: { type: "customer" | "staff" | "asset" | "sale"; id: string; label: string } | null;
}

const SEVERITY_ORDER: Record<ObligationSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function stateFor(daysUntil: number, leadDays: number): ObligationState {
  if (daysUntil < 0) return "OVERDUE";
  if (daysUntil === 0) return "DUE";
  if (daysUntil <= leadDays) return "SOON";
  return "SCHEDULED";
}

type ObligationWithSubjects = Obligation & {
  party: { id: string; name: string } | null;
  membership: { id: string; user: { name: string | null; email: string } | null } | null;
  item: { id: string; name: string } | null;
  transaction: { id: string } | null;
};

const SUBJECT_INCLUDE = {
  party: { select: { id: true, name: true } },
  membership: { select: { id: true, user: { select: { name: true, email: true } } } },
  item: { select: { id: true, name: true } },
  transaction: { select: { id: true } },
} as const;

function toLine(o: ObligationWithSubjects, now: Date): RadarLine {
  const actionByAt = actionByDate(o);
  const daysUntil = daysBetween(now, actionByAt);

  let subject: RadarLine["subject"] = null;
  if (o.party) subject = { type: "customer", id: o.party.id, label: o.party.name };
  else if (o.membership)
    subject = {
      type: "staff",
      id: o.membership.id,
      label: o.membership.user?.name ?? o.membership.user?.email ?? "Team member",
    };
  else if (o.item) subject = { type: "asset", id: o.item.id, label: o.item.name };
  else if (o.transaction) subject = { type: "sale", id: o.transaction.id, label: "Sale" };

  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    authority: o.authority,
    reference: o.reference,
    dueAt: o.dueAt,
    actionByAt,
    daysUntil,
    severity: o.severity,
    state: stateFor(daysUntil, o.leadDays),
    consequence: o.consequence,
    blocksWork: o.blocksWork,
    recurrence: o.recurrence,
    subject,
  };
}

export interface ObligationRadar {
  overdue: RadarLine[];
  due: RadarLine[];
  soon: RadarLine[];
  scheduled: RadarLine[];
  /** Everything currently lapsed that is set to stop work, not merely warn about it. */
  blocking: RadarLine[];
  /** One sentence fit to be said out loud. Empty string when there is genuinely nothing to report. */
  summary: string;
}

/**
 * Everything open, sorted by when it has to be acted on and how badly it hurts.
 *
 * This is the read the agent makes on its proactive tick, so it returns the
 * whole open set rather than a page — a business with more than a few hundred
 * live obligations is not a business this product is for.
 */
export async function obligationRadar(
  tenantId: string,
  now: Date = new Date()
): Promise<ObligationRadar> {
  const rows = await prisma.obligation.findMany({
    where: { tenantId, status: ObligationStatus.OPEN },
    include: SUBJECT_INCLUDE,
    orderBy: { dueAt: "asc" },
  });

  const lines = rows
    .map((o) => toLine(o as ObligationWithSubjects, now))
    .sort(
      (a, b) =>
        a.daysUntil - b.daysUntil || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

  const overdue = lines.filter((l) => l.state === "OVERDUE");
  const due = lines.filter((l) => l.state === "DUE");
  const soon = lines.filter((l) => l.state === "SOON");
  const scheduled = lines.filter((l) => l.state === "SCHEDULED");
  const blocking = overdue.filter((l) => l.blocksWork);

  return { overdue, due, soon, scheduled, blocking, summary: summarise(overdue, due, soon) };
}

function summarise(overdue: RadarLine[], due: RadarLine[], soon: RadarLine[]): string {
  if (overdue.length === 0 && due.length === 0 && soon.length === 0) return "";

  // Lead with the single worst thing rather than a count. A count is a
  // number to dismiss; a named consequence is a decision to make.
  const worst = [...overdue, ...due, ...soon].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.daysUntil - b.daysUntil
  )[0];

  const when =
    worst.daysUntil < 0
      ? `${Math.abs(worst.daysUntil)} day${Math.abs(worst.daysUntil) === 1 ? "" : "s"} overdue`
      : worst.daysUntil === 0
        ? "due today"
        : `due in ${worst.daysUntil} day${worst.daysUntil === 1 ? "" : "s"}`;

  const head = `${worst.title} is ${when}.`;
  const tail = worst.consequence ? ` ${worst.consequence}` : "";
  const others = overdue.length + due.length + soon.length - 1;
  const rest = others > 0 ? ` ${others} other item${others === 1 ? "" : "s"} need attention.` : "";
  return head + tail + rest;
}

// ------------------------------------------------------------------ reading

export async function listObligations(
  tenantId: string,
  opts: { kind?: ObligationKind; status?: ObligationStatus; includeDone?: boolean } = {}
) {
  return prisma.obligation.findMany({
    where: {
      tenantId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.status
        ? { status: opts.status }
        : opts.includeDone
          ? {}
          : { status: ObligationStatus.OPEN }),
    },
    include: SUBJECT_INCLUDE,
    orderBy: { dueAt: "asc" },
  });
}

async function requireOwned(tenantId: string, obligationId: string) {
  const row = await prisma.obligation.findUnique({ where: { id: obligationId } });
  // Same shape as every other core module: a form post or a tool call that
  // names another workspace's row gets "not found", never someone else's data.
  if (!row || row.tenantId !== tenantId) throw new Error("That item isn't on your list.");
  return row;
}

// ------------------------------------------------------------------ writing

export interface AddObligationParams {
  tenantId: string;
  kind: ObligationKind;
  title: string;
  dueAt: Date;
  authority?: string | null;
  reference?: string | null;
  recurrence?: ObligationRecurrence;
  severity?: ObligationSeverity;
  leadDays?: number;
  consequence?: string | null;
  noticeDays?: number | null;
  autoRenews?: boolean;
  blocksWork?: boolean;
  partyId?: string | null;
  membershipId?: string | null;
  itemId?: string | null;
  transactionId?: string | null;
  notes?: string | null;
  previousId?: string | null;
  /** The library row this came from, when it came from one. */
  templateId?: string | null;
}

export async function addObligation(params: AddObligationParams) {
  // Subjects are verified against the tenant before they are stored. Without
  // this an obligation could be attached to another workspace's customer or
  // vehicle, and would then show up on their radar.
  await assertSubjectsOwned(params);

  return prisma.obligation.create({
    data: {
      tenantId: params.tenantId,
      kind: params.kind,
      title: params.title.trim(),
      dueAt: params.dueAt,
      authority: params.authority ?? null,
      reference: params.reference ?? null,
      recurrence: params.recurrence ?? ObligationRecurrence.NONE,
      severity: params.severity ?? ObligationSeverity.MEDIUM,
      leadDays: params.leadDays ?? defaultLeadDays(params.kind, params.severity),
      consequence: params.consequence ?? null,
      noticeDays: params.noticeDays ?? null,
      autoRenews: params.autoRenews ?? false,
      blocksWork: params.blocksWork ?? false,
      partyId: params.partyId ?? null,
      membershipId: params.membershipId ?? null,
      itemId: params.itemId ?? null,
      transactionId: params.transactionId ?? null,
      notes: params.notes ?? null,
      previousId: params.previousId ?? null,
      templateId: params.templateId ?? null,
    },
  });
}

async function assertSubjectsOwned(p: AddObligationParams) {
  const checks: Array<Promise<void>> = [];
  const own = async (found: { tenantId: string } | null, label: string) => {
    if (!found || found.tenantId !== p.tenantId) throw new Error(`${label} not found.`);
  };

  if (p.partyId)
    checks.push(
      prisma.party
        .findUnique({ where: { id: p.partyId }, select: { tenantId: true } })
        .then((r) => own(r, "Customer"))
    );
  if (p.membershipId)
    checks.push(
      prisma.membership
        .findUnique({ where: { id: p.membershipId }, select: { tenantId: true } })
        .then((r) => own(r, "Team member"))
    );
  if (p.itemId)
    checks.push(
      prisma.item
        .findUnique({ where: { id: p.itemId }, select: { tenantId: true } })
        .then((r) => own(r, "Item"))
    );
  if (p.transactionId)
    checks.push(
      prisma.transaction
        .findUnique({ where: { id: p.transactionId }, select: { tenantId: true } })
        .then((r) => own(r, "Document"))
    );

  await Promise.all(checks);
}

/**
 * How early this stops being background and becomes work.
 *
 * Seeded from kind and severity because the right answer is genuinely
 * different per obligation and nobody will set it by hand: a CIPC return
 * wants a month's warning because the filing itself takes time, a licence
 * disc wants a week because renewing it is an errand.
 */
export function defaultLeadDays(kind: ObligationKind, severity?: ObligationSeverity): number {
  if (severity === ObligationSeverity.CRITICAL) return 45;
  switch (kind) {
    case ObligationKind.COMPLIANCE_FILING:
      return 30;
    case ObligationKind.CONTRACT:
      return 45; // renegotiation needs lead time, not a reminder on the day
    case ObligationKind.CERTIFICATE:
    case ObligationKind.LICENCE:
    case ObligationKind.INSURANCE:
      return 30;
    case ObligationKind.TAX:
      return 14;
    case ObligationKind.DOCUMENT:
      return 21;
    case ObligationKind.WARRANTY:
      return 14;
    default:
      return 30;
  }
}

export interface CompleteObligationParams {
  tenantId: string;
  obligationId: string;
  completedAt?: Date;
  documentDataUrl?: string | null;
  notes?: string | null;
}

export interface CompleteObligationResult {
  completed: Obligation;
  /** The next occurrence, when this one repeats. Null for a one-off. */
  next: Obligation | null;
}

/**
 * Mark it done, and — if it repeats — put the next one on the list immediately.
 *
 * Creating the successor here rather than on a nightly sweep is deliberate:
 * the moment an annual return is filed is the moment the business is safe for
 * a year, and the list should say so. A recurring obligation that only
 * reappears when a cron runs leaves a window where the radar is silently
 * wrong.
 *
 * The next occurrence is measured from the ORIGINAL due date, not from when
 * it was actually done — otherwise filing three weeks late permanently drags
 * the whole schedule three weeks later, and after a few years the dates no
 * longer match what the authority expects.
 */
export async function completeObligation(
  params: CompleteObligationParams
): Promise<CompleteObligationResult> {
  const row = await requireOwned(params.tenantId, params.obligationId);
  const completedAt = params.completedAt ?? new Date();

  const completed = await prisma.obligation.update({
    where: { id: row.id },
    data: {
      status: ObligationStatus.DONE,
      completedAt,
      ...(params.documentDataUrl !== undefined
        ? { documentDataUrl: params.documentDataUrl }
        : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });

  // The non-profit module has recorded filings since long before this engine
  // existed, and its page reads that table. Keeping the log written means
  // nothing there breaks and the history stays in one place.
  if (row.kind === ObligationKind.COMPLIANCE_FILING) {
    await prisma.complianceFiling.create({
      data: {
        tenantId: row.tenantId,
        filingType: row.title,
        filingDate: completedAt,
        documentDataUrl: params.documentDataUrl ?? null,
        notes: params.notes ?? null,
      },
    });
  }

  const nextDue = advanceRecurrence(row.dueAt, row.recurrence);
  if (!nextDue) return { completed, next: null };

  const next = await prisma.obligation.create({
    data: {
      tenantId: row.tenantId,
      kind: row.kind,
      title: row.title,
      authority: row.authority,
      reference: row.reference,
      dueAt: nextDue,
      recurrence: row.recurrence,
      severity: row.severity,
      leadDays: row.leadDays,
      consequence: row.consequence,
      noticeDays: row.noticeDays,
      autoRenews: row.autoRenews,
      blocksWork: row.blocksWork,
      partyId: row.partyId,
      membershipId: row.membershipId,
      itemId: row.itemId,
      transactionId: row.transactionId,
      templateId: row.templateId,
      previousId: row.id,
    },
  });

  return { completed, next };
}

/**
 * Consciously decide this one does not apply.
 *
 * Kept rather than deleted, because "why isn't the liquor licence on our
 * list" is a question somebody asks eighteen months later, and "someone
 * removed it" is a worse answer than "it was waived on this date".
 */
export async function waiveObligation(params: {
  tenantId: string;
  obligationId: string;
  reason?: string;
}) {
  const row = await requireOwned(params.tenantId, params.obligationId);
  return prisma.obligation.update({
    where: { id: row.id },
    data: {
      status: ObligationStatus.WAIVED,
      notes: params.reason ?? row.notes,
    },
  });
}

export async function rescheduleObligation(params: {
  tenantId: string;
  obligationId: string;
  dueAt: Date;
}) {
  const row = await requireOwned(params.tenantId, params.obligationId);
  return prisma.obligation.update({ where: { id: row.id }, data: { dueAt: params.dueAt } });
}

// ------------------------------------------------------------------ guardrail

export interface BlockingObligation {
  id: string;
  title: string;
  kind: ObligationKind;
  dueAt: Date;
  daysOverdue: number;
  consequence: string | null;
}

/**
 * Lapsed obligations that are set to stop work on a given person, vehicle or
 * customer — not warn about it.
 *
 * This is what makes the arc more than a calendar. An expired PDP or a
 * lapsed public liability policy is not something to mention on a dashboard
 * the owner opens on Sundays; it is a reason today's dispatch does not
 * happen.
 */
export async function blockingObligationsFor(
  tenantId: string,
  subject: { membershipId?: string; itemId?: string; partyId?: string },
  now: Date = new Date()
): Promise<BlockingObligation[]> {
  const subjectWhere: Array<
    { membershipId: string } | { itemId: string } | { partyId: string }
  > = [];
  if (subject.membershipId) subjectWhere.push({ membershipId: subject.membershipId });
  if (subject.itemId) subjectWhere.push({ itemId: subject.itemId });
  if (subject.partyId) subjectWhere.push({ partyId: subject.partyId });

  if (subjectWhere.length === 0) return [];

  const rows = await prisma.obligation.findMany({
    where: {
      tenantId,
      status: ObligationStatus.OPEN,
      blocksWork: true,
      dueAt: { lt: now },
      OR: subjectWhere,
    },
    orderBy: { dueAt: "asc" },
  });

  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    kind: o.kind,
    dueAt: o.dueAt,
    daysOverdue: Math.abs(daysBetween(now, o.dueAt)),
    consequence: o.consequence,
  }));
}

export class WorkBlockedError extends Error {
  readonly blocking: BlockingObligation[];
  constructor(blocking: BlockingObligation[]) {
    const first = blocking[0];
    super(
      `${first.title} lapsed ${first.daysOverdue} day${first.daysOverdue === 1 ? "" : "s"} ago.` +
        (first.consequence ? ` ${first.consequence}` : "")
    );
    this.name = "WorkBlockedError";
    this.blocking = blocking;
  }
}

/** Throws if anything lapsed on this subject is set to stop work. */
export async function assertNotBlocked(
  tenantId: string,
  subject: { membershipId?: string; itemId?: string; partyId?: string },
  now: Date = new Date()
): Promise<void> {
  const blocking = await blockingObligationsFor(tenantId, subject, now);
  if (blocking.length > 0) throw new WorkBlockedError(blocking);
}
