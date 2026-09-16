// Which kind of work is quietly losing money.
//
// jobMargins answers "what did this job make". It is the right number and it
// is almost never the question an owner actually has, because forty rows of
// job margin is data, not an answer. The question is: which *sort* of work
// should we stop taking?
//
// A business rarely loses money evenly. It loses it on one kind of job —
// small callouts, one particular customer's site, anything involving a hired
// machine — and the loss hides because the total is fine. Grouping the same
// margins by the kind of work makes the loser visible in one line.
//
// "Kind" is read off what was actually sold rather than a field somebody has
// to maintain: the catalogue item that appears on the most lines of the
// document is what that document was for. A field nobody fills in is a report
// nobody can run.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";
import { jobMargins, type JobMargin, type Period } from "./costing";

export interface WorkKind {
  key: string;
  label: string;
  jobs: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPercent: number | null;
  /** The worst single job of this kind, which is usually the story. */
  worst: { transactionId: string; customer: string; marginCents: number } | null;
  /** How many of this kind lost money outright. */
  lossMaking: number;
}

export interface WorkKindReport {
  currency: string;
  kinds: WorkKind[];
  /** The one worth saying out loud, or nothing when everything is fine. */
  finding: string | null;
  totalMarginCents: number;
}

/**
 * The item that best describes a document.
 *
 * The highest-value line rather than the first, because a job with a R40 000
 * inverter and a R200 cable tie is an inverter job, and the order lines were
 * typed in is meaningless.
 */
async function kindOfEach(tenantId: string, transactionIds: string[]): Promise<Map<string, { key: string; label: string }>> {
  const out = new Map<string, { key: string; label: string }>();
  if (transactionIds.length === 0) return out;

  const lines = await prisma.transactionLine.findMany({
    where: { transactionId: { in: transactionIds }, item: { tenantId } },
    select: {
      transactionId: true,
      quantity: true,
      unitPriceCents: true,
      item: { select: { id: true, name: true, category: true } },
    },
  });

  const best = new Map<string, { value: number; key: string; label: string }>();
  for (const line of lines) {
    const value = line.quantity * line.unitPriceCents;
    const current = best.get(line.transactionId);
    if (current && current.value >= value) continue;
    // A category is a better grouping than an item when the business keeps
    // them, because ten inverter models are one kind of work.
    best.set(line.transactionId, {
      value,
      key: line.item.category ? `category:${line.item.category.toLowerCase()}` : `item:${line.item.id}`,
      label: line.item.category ?? line.item.name,
    });
  }

  for (const [transactionId, row] of best) out.set(transactionId, { key: row.key, label: row.label });
  return out;
}

function costOf(job: JobMargin): number {
  return job.cogsCents + job.directCents + job.travelCents;
}

export async function workKindMargins(tenantId: string, period: Period): Promise<WorkKindReport> {
  const [tenant, jobs] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
    jobMargins(tenantId, period),
  ]);

  const kinds = await kindOfEach(
    tenantId,
    jobs.map((j) => j.transactionId)
  );

  const by = new Map<string, WorkKind>();
  for (const job of jobs) {
    const kind = kinds.get(job.transactionId) ?? { key: "unclassified", label: "Everything else" };
    const row =
      by.get(kind.key) ??
      ({
        key: kind.key,
        label: kind.label,
        jobs: 0,
        revenueCents: 0,
        costCents: 0,
        marginCents: 0,
        marginPercent: null,
        worst: null,
        lossMaking: 0,
      } satisfies WorkKind);

    row.jobs += 1;
    row.revenueCents += job.revenueCents;
    row.costCents += costOf(job);
    row.marginCents += job.marginCents;
    if (job.marginCents < 0) row.lossMaking += 1;
    if (!row.worst || job.marginCents < row.worst.marginCents) {
      row.worst = { transactionId: job.transactionId, customer: job.partyName, marginCents: job.marginCents };
    }
    by.set(kind.key, row);
  }

  const rows = [...by.values()].map((r) => ({
    ...r,
    marginPercent: r.revenueCents > 0 ? Math.round((r.marginCents / r.revenueCents) * 1000) / 10 : null,
  }));
  rows.sort((a, b) => a.marginCents - b.marginCents);

  const totalMargin = rows.reduce((s, r) => s + r.marginCents, 0);
  const money = (c: number) => formatMoney(c, tenant.currency);

  // The finding is deliberately one sentence and only appears when there is
  // something to say. A report that always has a headline trains people to
  // ignore the headline.
  let finding: string | null = null;
  const worstKind = rows[0];
  if (worstKind && worstKind.jobs >= 2 && worstKind.marginCents < 0) {
    finding =
      `${worstKind.label} lost ${money(Math.abs(worstKind.marginCents))} across ${worstKind.jobs} jobs` +
      (totalMargin > 0 ? `, while everything else made ${money(totalMargin - worstKind.marginCents)}.` : ".") +
      ` ${worstKind.lossMaking} of ${worstKind.jobs} were under water.`;
  } else if (worstKind && worstKind.jobs >= 3 && worstKind.marginPercent !== null && worstKind.marginPercent < 10) {
    const others = rows.slice(1).filter((r) => r.marginPercent !== null);
    const typical = others.length > 0 ? Math.round(others.reduce((s, r) => s + (r.marginPercent ?? 0), 0) / others.length) : null;
    finding =
      `${worstKind.label} runs at ${worstKind.marginPercent}% across ${worstKind.jobs} jobs` +
      (typical !== null ? `, against about ${typical}% on everything else.` : ".");
  }

  return { currency: tenant.currency, kinds: rows, finding, totalMarginCents: totalMargin };
}
