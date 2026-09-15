// The observation bus.
//
// Officers do not notify. They write down what they noticed — the fact, its
// evidence, the money at stake, how sure they are — and something else
// decides whether it reaches a person.
//
// The distinction matters more than it sounds. A notification can only be
// sent or not sent, now. An observation can be held back today and raised on
// Thursday when it has got worse; deduplicated against two other officers who
// spotted the same underlying problem; ranked against everything else
// competing for the same attention; and remembered, so a suggestion somebody
// rejected is never offered again.
//
// Nothing here talks to a person. That is the coordinator's job, and it is
// the only thing in the system with that privilege.

import { prisma } from "@/lib/db";
import { Officer, ObservationStatus, type Observation } from "@prisma/client";
import { assertMay } from "./ladder";

export interface EvidenceItem {
  label: string;
  value: string;
  /** Where to go and check it. */
  href?: string;
}

export interface ObserveParams {
  tenantId: string;
  officer: Officer;
  /** One sentence, quotable as-is. This is what a person reads. */
  headline: string;
  detail?: string | null;
  /** In cents. The strongest ranking signal there is. */
  moneyCents?: number | null;
  /** 0-100. Being unsure is fine; hiding it is not. */
  confidence?: number;
  /** After this, acting is pointless rather than merely late. */
  urgentBy?: Date | null;
  /**
   * What makes this the same conversation as another observation. Same
   * subject and same kind of problem should produce the same key, across
   * officers — that is what lets three findings about one struggling
   * customer reach somebody once.
   */
  dedupeKey: string;
  subjectType?: string | null;
  subjectId?: string | null;
  evidence?: EvidenceItem[];
  proposedAction?: string | null;
  handedTo?: Officer | null;
}

export class DismissedAlreadyError extends Error {
  constructor(headline: string) {
    super(`Already dismissed by this business: ${headline}`);
    this.name = "DismissedAlreadyError";
  }
}

/** How long a rejected suggestion stays rejected before it may be raised again. */
const DISMISSAL_RESPECTED_DAYS = 90;

/**
 * Write an observation.
 *
 * Three things happen here that make the bus more than a table:
 *
 *  - The officer's ceiling is checked. An officer set to OBSERVE may still
 *    write; it simply never gets raised. That is a real setting somebody
 *    might want — a CEO that watches quietly for a quarter before it earns
 *    the right to speak.
 *
 *  - Anything the business has already rejected on this key is respected.
 *    Re-suggesting something somebody said no to is the fastest way to make
 *    an assistant feel stupid, and it is entirely avoidable.
 *
 *  - An older open observation on the same key is superseded rather than
 *    duplicated, so the bus holds the current state of a problem and not a
 *    log of every time an officer noticed it.
 */
export async function observe(params: ObserveParams): Promise<Observation | null> {
  await assertMay(params.tenantId, params.officer, "OBSERVE");

  const since = new Date(Date.now() - DISMISSAL_RESPECTED_DAYS * 86_400_000);
  const dismissed = await prisma.observation.findFirst({
    where: {
      tenantId: params.tenantId,
      dedupeKey: params.dedupeKey,
      status: ObservationStatus.DISMISSED,
      decidedAt: { gte: since },
    },
    select: { id: true },
  });
  if (dismissed) return null;

  const confidence = Math.max(0, Math.min(100, Math.round(params.confidence ?? 50)));

  return prisma.$transaction(async (tx) => {
    const superseded = await tx.observation.findFirst({
      where: {
        tenantId: params.tenantId,
        dedupeKey: params.dedupeKey,
        status: { in: [ObservationStatus.OPEN, ObservationStatus.RAISED] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (superseded) {
      await tx.observation.update({
        where: { id: superseded.id },
        data: { status: ObservationStatus.SUPERSEDED },
      });
    }

    return tx.observation.create({
      data: {
        tenantId: params.tenantId,
        officer: params.officer,
        headline: params.headline.trim(),
        detail: params.detail ?? null,
        moneyCents: params.moneyCents ?? null,
        confidence,
        urgentBy: params.urgentBy ?? null,
        dedupeKey: params.dedupeKey,
        subjectType: params.subjectType ?? null,
        subjectId: params.subjectId ?? null,
        evidence: params.evidence ? (params.evidence as unknown as object) : undefined,
        proposedAction: params.proposedAction ?? null,
        handedTo: params.handedTo ?? null,
        supersedesId: superseded?.id ?? null,
      },
    });
  });
}

/**
 * Hand an observation to the officer who owns the domain.
 *
 * Exactly one hop, deliberately. Agent-to-agent conversation is where cost
 * and latency disappear with nothing to show for it, and an observation that
 * has been passed twice is one nobody owns.
 */
export async function handOff(params: {
  tenantId: string;
  observationId: string;
  to: Officer;
  note?: string;
}): Promise<Observation> {
  const row = await prisma.observation.findUnique({ where: { id: params.observationId } });
  if (!row || row.tenantId !== params.tenantId) throw new Error("Observation not found.");
  if (row.handedTo) {
    throw new Error("That has already been handed over once — a second hop means nobody owns it.");
  }
  if (row.officer === params.to) throw new Error("It is already theirs.");

  return prisma.observation.update({
    where: { id: row.id },
    data: {
      handedTo: params.to,
      detail: params.note ? `${row.detail ? `${row.detail}\n\n` : ""}${params.note}` : row.detail,
    },
  });
}

export async function listOpen(tenantId: string, take = 200) {
  return prisma.observation.findMany({
    where: { tenantId, status: ObservationStatus.OPEN },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listRaised(tenantId: string, take = 50) {
  return prisma.observation.findMany({
    where: { tenantId, status: ObservationStatus.RAISED },
    orderBy: { raisedAt: "desc" },
    take,
  });
}

export async function markRaised(ids: string[], at = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await prisma.observation.updateMany({
    where: { id: { in: ids } },
    data: { status: ObservationStatus.RAISED, raisedAt: at },
  });
}

export async function decide(params: {
  tenantId: string;
  observationId: string;
  actioned: boolean;
  byId?: string | null;
  note?: string | null;
}): Promise<Observation> {
  const row = await prisma.observation.findUnique({ where: { id: params.observationId } });
  if (!row || row.tenantId !== params.tenantId) throw new Error("Observation not found.");

  return prisma.observation.update({
    where: { id: row.id },
    data: {
      status: params.actioned ? ObservationStatus.ACTIONED : ObservationStatus.DISMISSED,
      decidedAt: new Date(),
      decidedById: params.byId ?? null,
      decisionNote: params.note ?? null,
    },
  });
}

/**
 * Retire observations that were never worth raising.
 *
 * Without this the bus fills with findings that were true for a week in March
 * and quietly distort every ranking afterwards. Anything past its urgency,
 * and anything open and untouched for a long time, stops competing.
 */
export async function expireStale(tenantId: string, now = new Date()): Promise<number> {
  // Deliberately NOT "past its urgency". Something one day overdue is the most
  // important thing on the bus, not the least — the ranking scores it highest
  // precisely because the cost is already being paid. Expiring on the urgency
  // date would delete the best observations moments before they were raised,
  // which is what an earlier version of this did.
  //
  // What genuinely goes stale is something long past the point of acting, or
  // something that sat open for two months without ever ranking high enough to
  // be worth a person's attention.
  const wellPast = new Date(now.getTime() - 30 * 86_400_000);
  const longAgo = new Date(now.getTime() - 60 * 86_400_000);

  const { count } = await prisma.observation.updateMany({
    where: {
      tenantId,
      status: ObservationStatus.OPEN,
      OR: [{ urgentBy: { lt: wellPast } }, { createdAt: { lt: longAgo } }],
    },
    data: { status: ObservationStatus.EXPIRED },
  });
  return count;
}

/**
 * What an officer should know about its own past suggestions.
 *
 * Read into an officer's context so it can see what this business has
 * accepted and rejected, and stop proposing the kind of thing they keep
 * turning down.
 */
export async function officerHistory(tenantId: string, officer: Officer, take = 20) {
  const rows = await prisma.observation.findMany({
    where: {
      tenantId,
      OR: [{ officer }, { handedTo: officer }],
      status: { in: [ObservationStatus.ACTIONED, ObservationStatus.DISMISSED] },
    },
    orderBy: { decidedAt: "desc" },
    take,
    select: { headline: true, status: true, decisionNote: true, decidedAt: true },
  });

  return rows.map((r) => ({
    headline: r.headline,
    outcome: r.status === ObservationStatus.ACTIONED ? ("accepted" as const) : ("rejected" as const),
    why: r.decisionNote,
    on: r.decidedAt,
  }));
}
