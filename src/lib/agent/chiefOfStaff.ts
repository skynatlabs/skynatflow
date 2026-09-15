// The only thing permitted to speak unprompted.
//
// Six officers writing observations is useless without something that decides
// which three reach a person today. That decision is this file, and it is
// deliberately arithmetic rather than a model: what gets a person's attention
// should be predictable, explainable, and not subject to a language model
// having an opinion about its own importance.
//
// Three mechanics do the work:
//
//   RANK BY MONEY, not recency. An assistant that cannot rank by money ranks
//   by recency, which is how trivia crowds out the thing that mattered.
//   Money is log-scaled so a single R2m observation does not permanently
//   drown out five R40k ones that are collectively worth more attention.
//
//   A HARD DAILY BUDGET. There is a limit on what may be raised per day, and
//   it is small. Everything below the line stays on the bus, findable, and
//   gets reconsidered tomorrow — when it may well have got worse and earned
//   its place.
//
//   DEDUPLICATE ACROSS OFFICERS. Three officers noticing one struggling
//   customer is one conversation to have, not three interruptions.

import { prisma } from "@/lib/db";
import { Officer, ObservationStatus, type Observation } from "@prisma/client";
import { may } from "./ladder";
import { expireStale, markRaised } from "./observations";
import type { EvidenceItem } from "./observations";

/** How many things may be put in front of a person in a day. */
export const DAILY_ATTENTION_BUDGET = 4;

export interface RankedItem {
  observationId: string;
  officer: Officer;
  handedTo: Officer | null;
  headline: string;
  detail: string | null;
  moneyCents: number | null;
  confidence: number;
  urgentBy: Date | null;
  proposedAction: string | null;
  evidence: EvidenceItem[];
  subjectType: string | null;
  subjectId: string | null;
  score: number;
  /** Officers that independently noticed the same thing. */
  alsoNoticedBy: Officer[];
  /** Ids folded into this one, so deciding this decides all of them. */
  mergedIds: string[];
}

export interface Brief {
  items: RankedItem[];
  /** Ranked but below the budget line. Available, not raised. */
  heldBack: number;
  /** One sentence for a phone notification, or empty when nothing is worth one. */
  headline: string;
  generatedAt: Date;
}

/**
 * Money, log-scaled to 0-1.
 *
 * Linear money makes one large number dominate forever; ignoring money makes
 * everything equally urgent. A log curve says a R500k problem matters much
 * more than a R5k one and only somewhat more than a R200k one, which is how
 * people actually weigh these.
 */
function moneyWeight(cents: number | null): number {
  if (!cents || cents <= 0) return 0.15; // not nothing — some things matter without a price
  const rands = Math.abs(cents) / 100;
  // log10(1) = 0 at R1, log10(1_000_000) = 6. Saturates around a million.
  return Math.min(1, Math.log10(rands + 1) / 6);
}

/**
 * Urgency, 0-1.
 *
 * Something already past its date scores highest — being late is worse than
 * being imminent, because the cost is already being paid.
 */
function urgencyWeight(urgentBy: Date | null, now: Date): number {
  if (!urgentBy) return 0.4;
  const days = (urgentBy.getTime() - now.getTime()) / 86_400_000;
  if (days <= 0) return 1;
  if (days <= 3) return 0.9;
  if (days <= 14) return 0.65;
  if (days <= 45) return 0.4;
  return 0.2;
}

function score(o: Observation, now: Date): number {
  const money = moneyWeight(o.moneyCents);
  const urgency = urgencyWeight(o.urgentBy, now);
  const confidence = Math.max(5, o.confidence) / 100;
  // Multiplicative: something has to be worth money AND timely AND believed.
  // A sum would let a single high dimension carry a weak observation through.
  return money * urgency * confidence * 1000;
}

function readEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is EvidenceItem =>
      typeof e === "object" && e !== null && typeof (e as EvidenceItem).label === "string"
  );
}

/**
 * Build today's brief.
 *
 * Does not send anything. It decides, marks what it raised, and returns it —
 * so the caller can render it, notify on it, or in a test simply read it.
 */
export async function buildBrief(
  tenantId: string,
  opts: { now?: Date; budget?: number } = {}
): Promise<Brief> {
  const now = opts.now ?? new Date();
  const budget = opts.budget ?? DAILY_ATTENTION_BUDGET;

  await expireStale(tenantId, now);

  const open = await prisma.observation.findMany({
    where: { tenantId, status: ObservationStatus.OPEN },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // An officer below SUGGEST watches quietly: it may write, and nothing it
  // writes reaches anybody. That is a real setting somebody might choose.
  const allowed: Observation[] = [];
  const speaks = new Map<Officer, boolean>();
  for (const o of open) {
    const officer = o.handedTo ?? o.officer;
    if (!speaks.has(officer)) speaks.set(officer, await may(tenantId, officer, "SUGGEST"));
    if (speaks.get(officer)) allowed.push(o);
  }

  // One conversation per subject, whoever noticed it.
  const groups = new Map<string, Observation[]>();
  for (const o of allowed) {
    const key = o.subjectId ? `${o.subjectType ?? "?"}:${o.subjectId}` : `k:${o.dedupeKey}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(o);
    groups.set(key, bucket);
  }

  const ranked: RankedItem[] = [];
  for (const bucket of groups.values()) {
    const scored = bucket
      .map((o) => ({ o, s: score(o, now) }))
      .sort((a, b) => b.s - a.s);
    const lead = scored[0];
    const others = scored.slice(1);

    ranked.push({
      observationId: lead.o.id,
      officer: lead.o.officer,
      handedTo: lead.o.handedTo,
      headline: lead.o.headline,
      detail: lead.o.detail,
      moneyCents: lead.o.moneyCents,
      confidence: lead.o.confidence,
      urgentBy: lead.o.urgentBy,
      proposedAction: lead.o.proposedAction,
      evidence: readEvidence(lead.o.evidence),
      subjectType: lead.o.subjectType,
      subjectId: lead.o.subjectId,
      // Corroboration is itself a signal: two officers independently
      // reaching the same place is more likely to be real than one.
      score: lead.s * (1 + Math.min(others.length, 3) * 0.12),
      alsoNoticedBy: [...new Set(others.map((x) => x.o.handedTo ?? x.o.officer))],
      mergedIds: others.map((x) => x.o.id),
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  const items = ranked.slice(0, budget);
  const heldBack = ranked.length - items.length;

  await markRaised(items.flatMap((i) => [i.observationId, ...i.mergedIds]), now);

  return { items, heldBack, headline: headlineFor(items, heldBack), generatedAt: now };
}

function headlineFor(items: RankedItem[], heldBack: number): string {
  if (items.length === 0) return "";

  const lead = items[0];
  const extra = items.length - 1 + heldBack;
  if (extra === 0) return lead.headline;

  // The officer's sentence is a complete one and ends in a full stop, so the
  // tail is joined to its stem rather than appended after the punctuation.
  const stem = lead.headline.replace(/\.\s*$/, "");

  // Lead with the sentence the officer wrote, not a count. A count is a number
  // to dismiss; a named problem is a decision to make.
  return `${stem}, and ${extra} other thing${extra === 1 ? "" : "s"}.`;
}

// ------------------------------------------------------------------ queue

export type QueueKind = "observation" | "agent_action" | "draft_message";

export interface QueueItem {
  kind: QueueKind;
  id: string;
  title: string;
  detail: string | null;
  officer: Officer | null;
  moneyCents: number | null;
  createdAt: Date;
  /** Ordering across every kind, so one list is genuinely one list. */
  score: number;
}

/**
 * Everything waiting on a human, from every source, as one ranked list.
 *
 * The queue predates the officers — agent runs held for approval and drafted
 * customer messages already existed — and the point of this function is that
 * they stop being three places to check. Six officers with six inboxes is
 * precisely the failure the whole coordination layer exists to avoid, and it
 * would be an odd thing to introduce while building the fix for it.
 */
export async function approvalQueue(tenantId: string, now = new Date()): Promise<QueueItem[]> {
  const [observations, runs, drafts] = await Promise.all([
    prisma.observation.findMany({
      where: { tenantId, status: ObservationStatus.RAISED },
      orderBy: { raisedAt: "desc" },
      take: 50,
    }),
    prisma.agentRun.findMany({
      where: { tenantId, status: "AWAITING_APPROVAL" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, reply: true, input: true, createdAt: true },
    }),
    prisma.aiDraft.findMany({
      where: { tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        body: true,
        reasoning: true,
        createdAt: true,
        party: { select: { name: true } },
      },
    }),
  ]);

  const items: QueueItem[] = [
    ...observations.map((o) => ({
      kind: "observation" as const,
      id: o.id,
      title: o.headline,
      detail: o.proposedAction ?? o.detail,
      officer: o.handedTo ?? o.officer,
      moneyCents: o.moneyCents,
      createdAt: o.raisedAt ?? o.createdAt,
      score: score(o, now),
    })),
    ...runs.map((r) => ({
      kind: "agent_action" as const,
      id: r.id,
      title: "An action is waiting for your approval",
      // The reply is what the agent said it was doing; the input is what it
      // was asked. Either is more useful than a generic title.
      detail: r.reply ?? r.input,
      officer: null,
      moneyCents: null,
      // Staged actions sit high: somebody is one click from something real
      // happening, and leaving that ambiguous is worse than leaving a
      // suggestion unread.
      createdAt: r.createdAt,
      score: 620,
    })),
    ...drafts.map((d) => ({
      kind: "draft_message" as const,
      id: d.id,
      title: `A message to ${d.party.name} is ready to send`,
      detail: d.reasoning,
      officer: "SALES" as Officer,
      moneyCents: null,
      createdAt: d.createdAt,
      score: 400,
    })),
  ];

  return items.sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
}
