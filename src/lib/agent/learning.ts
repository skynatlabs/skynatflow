// Did it work, and do they want it?
//
// Two questions an agent that acts on a business has to be able to answer
// about itself, and neither is answerable from a model. Both are arithmetic
// over what has already happened:
//
//   WHAT THEY ACCEPT. Every approval and every rejection is a judgement about
//   a kind of proposal, and a system that proposes the same rejected thing
//   forty times is one somebody switches off. So the rates are counted per
//   kind, and what is consistently refused is fed back into the prompt as
//   something this business does not want — not as a rule that silences it,
//   which would hide a finding that has become urgent.
//
//   WHETHER IT HELPED. A chaser sent is not a result; a chaser sent and the
//   invoice paid four days later is. The measurement is deliberately coarse
//   and honest about it — this is correlation, said as correlation, because
//   claiming causation from it is exactly how this kind of number stops being
//   believed.

import { prisma } from "@/lib/db";

export interface KindRate {
  kind: string;
  proposed: number;
  accepted: number;
  rejected: number;
  acceptRate: number | null;
}

/**
 * What this business accepts, by kind of finding.
 *
 * "Kind" is the observation's dedupe key without its subject — cfo:overdue
 * rather than cfo:overdue:some-invoice-id — because the judgement is about
 * the sort of thing, not about one invoice.
 */
export async function acceptanceByKind(tenantId: string, opts: { sinceDays?: number; now?: Date } = {}): Promise<KindRate[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 180) * 86_400_000);

  const rows = await prisma.observation.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: { dedupeKey: true, status: true, decidedAt: true },
  });

  const by = new Map<string, KindRate>();
  for (const row of rows) {
    const kind = (row.dedupeKey ?? "unknown").split(":").slice(0, 2).join(":");
    const rate = by.get(kind) ?? { kind, proposed: 0, accepted: 0, rejected: 0, acceptRate: null };
    rate.proposed += 1;
    if (row.status === "ACTIONED") rate.accepted += 1;
    else if (row.status === "DISMISSED") rate.rejected += 1;
    by.set(kind, rate);
  }

  return [...by.values()]
    .map((r) => ({ ...r, acceptRate: r.accepted + r.rejected === 0 ? null : Math.round((r.accepted / (r.accepted + r.rejected)) * 100) }))
    .sort((a, b) => b.proposed - a.proposed);
}

/**
 * What to tell the model about this workspace's taste.
 *
 * Only kinds with enough decisions to mean something, and phrased as
 * preference rather than prohibition — a finding that has been refused four
 * times may be genuinely urgent the fifth, and a hard rule would bury it.
 */
export async function preferenceNotes(tenantId: string, now = new Date()): Promise<string[]> {
  const rates = await acceptanceByKind(tenantId, { now });
  const notes: string[] = [];

  for (const rate of rates) {
    const decided = rate.accepted + rate.rejected;
    // Four is where a pattern stops being two people having a bad week.
    if (decided < 4) continue;
    if (rate.acceptRate !== null && rate.acceptRate <= 25) {
      notes.push(
        `This business has turned down ${rate.rejected} of ${decided} "${rate.kind}" findings. Raise one only when it is materially worse than the ones they refused, and say what is different about it.`
      );
    } else if (rate.acceptRate !== null && rate.acceptRate >= 80) {
      notes.push(`This business acts on "${rate.kind}" findings almost every time — they are worth raising early.`);
    }
  }
  return notes.slice(0, 6);
}

export interface OutcomeMeasure {
  kind: string;
  acted: number;
  /** Of those acted on, how many reached the outcome that kind is aiming at. */
  worked: number;
  /** Median days between acting and the outcome. */
  medianDays: number | null;
  note: string;
}

/**
 * Whether acting on a finding actually changed anything.
 *
 * Only the kinds with an observable outcome are measured — an overdue finding
 * is measurable because the invoice either got paid or did not. A "your
 * margin is thin" finding has no event to look for, so it is left out rather
 * than given a made-up denominator.
 */
export async function outcomes(tenantId: string, opts: { sinceDays?: number; now?: Date } = {}): Promise<OutcomeMeasure[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 180) * 86_400_000);

  const acted = await prisma.observation.findMany({
    where: { tenantId, status: "ACTIONED", decidedAt: { not: null, gte: since }, subjectId: { not: null } },
    select: { dedupeKey: true, subjectType: true, subjectId: true, decidedAt: true },
  });
  if (acted.length === 0) return [];

  const invoiceIds = acted.filter((o) => o.subjectType === "Transaction").map((o) => o.subjectId!) as string[];
  const settled = invoiceIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: invoiceIds }, tenantId, status: "PAID" },
        select: { id: true, children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      })
    : [];
  const paidOn = new Map(settled.map((s) => [s.id, s.children[0]?.createdAt]));

  const by = new Map<string, { acted: number; worked: number; gaps: number[] }>();
  for (const observation of acted) {
    const kind = (observation.dedupeKey ?? "unknown").split(":").slice(0, 2).join(":");
    const row = by.get(kind) ?? { acted: 0, worked: 0, gaps: [] };
    row.acted += 1;

    const paid = observation.subjectType === "Transaction" ? paidOn.get(observation.subjectId!) : undefined;
    if (paid && observation.decidedAt && paid >= observation.decidedAt) {
      row.worked += 1;
      row.gaps.push(Math.round((paid.getTime() - observation.decidedAt.getTime()) / 86_400_000));
    }
    by.set(kind, row);
  }

  return [...by.entries()]
    .filter(([, row]) => row.worked > 0)
    .map(([kind, row]) => {
      row.gaps.sort((a, b) => a - b);
      const median = row.gaps.length === 0 ? null : row.gaps[Math.floor(row.gaps.length / 2)];
      return {
        kind,
        acted: row.acted,
        worked: row.worked,
        medianDays: median,
        // Stated as correlation, because that is what it is. Claiming cause
        // from this is how a number like it stops being believed.
        note:
          `${row.worked} of ${row.acted} "${kind}" findings acted on were followed by the money landing` +
          (median !== null ? `, typically ${median} ${median === 1 ? "day" : "days"} later.` : ".") +
          " Followed by, not necessarily because of.",
      };
    })
    .sort((a, b) => b.acted - a.acted);
}

/** The one-paragraph version, for the officers page and the agent itself. */
export async function howItIsDoing(tenantId: string, now = new Date()) {
  const [rates, results] = await Promise.all([acceptanceByKind(tenantId, { now }), outcomes(tenantId, { now })]);
  const decided = rates.reduce((s, r) => s + r.accepted + r.rejected, 0);
  const accepted = rates.reduce((s, r) => s + r.accepted, 0);

  return {
    findingsDecided: decided,
    accepted,
    acceptRate: decided === 0 ? null : Math.round((accepted / decided) * 100),
    byKind: rates,
    outcomes: results,
    summary:
      decided === 0
        ? "Nothing the officers have raised has been decided yet, so there is nothing to learn from."
        : `${accepted} of ${decided} findings were taken on` +
          (results.length > 0 ? `. ${results[0].note}` : ". Nothing acted on has a measurable outcome yet."),
  };
}
