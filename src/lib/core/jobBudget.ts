// What it was going to cost, against what it did.
//
// Margin per job already exists and is worked out after the fact, which is
// the right number at the wrong time: a job that has gone wrong is worth
// knowing about while it can still be stopped, not in next month's report.
//
// So this is the same arithmetic, live, against a figure somebody set at the
// start — with hours costed against the job rather than the day, and a
// subcontractor's price counted as what it is. The useful output is not the
// number; it is the list of jobs currently running over, while somebody can
// still ring the customer.

import { JobCardStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export interface JobBudget {
  jobCardId: string;
  title: string;
  customer: string;
  partyId: string;
  status: JobCardStatus;
  budgetCents: number | null;
  /** Costs somebody tagged to this job. */
  directCents: number;
  /** Hours clocked against it, at each person's cost rate. */
  labourCents: number;
  /** What a subcontractor is being paid, which is not what the customer pays. */
  subcontractCents: number;
  spentCents: number;
  remainingCents: number | null;
  /** Over 100 means it has eaten its budget. */
  usedPercent: number | null;
  hoursLogged: number;
  /** What the customer is being charged, where it came from a document. */
  chargedCents: number | null;
  marginCents: number | null;
}

/** Hours at the rate each person actually costs, not an average. */
async function labourFor(tenantId: string, jobCardIds: string[]) {
  if (jobCardIds.length === 0) return new Map<string, { cents: number; hours: number }>();

  const [entries, members] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { tenantId, jobCardId: { in: jobCardIds }, clockOutAt: { not: null } },
      select: { jobCardId: true, membershipId: true, clockInAt: true, clockOutAt: true },
    }),
    prisma.membership.findMany({ where: { tenantId }, select: { id: true, costRateCents: true } }),
  ]);
  const rateOf = new Map(members.map((m) => [m.id, m.costRateCents ?? 0]));

  const out = new Map<string, { cents: number; hours: number }>();
  for (const entry of entries) {
    if (!entry.jobCardId || !entry.clockOutAt) continue;
    const hours = (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 3_600_000;
    const row = out.get(entry.jobCardId) ?? { cents: 0, hours: 0 };
    row.hours += hours;
    row.cents += Math.round(hours * (rateOf.get(entry.membershipId) ?? 0));
    out.set(entry.jobCardId, row);
  }
  return out;
}

export async function jobBudgets(
  tenantId: string,
  opts: { jobCardIds?: string[]; openOnly?: boolean } = {}
): Promise<JobBudget[]> {
  const jobs = await prisma.jobCard.findMany({
    where: {
      tenantId,
      ...(opts.jobCardIds ? { id: { in: opts.jobCardIds } } : {}),
      ...(opts.openOnly ? { status: { not: JobCardStatus.DONE } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      party: { select: { id: true, name: true, companyName: true } },
      expenses: { select: { amountCents: true } },
      transaction: { select: { amountCents: true, status: true } },
    },
  });
  if (jobs.length === 0) return [];

  const labour = await labourFor(tenantId, jobs.map((j) => j.id));

  return jobs.map((job) => {
    const direct = job.expenses.reduce((s, e) => s + e.amountCents, 0);
    const time = labour.get(job.id) ?? { cents: 0, hours: 0 };
    const sub = job.subcontractCents ?? 0;
    const spent = direct + time.cents + sub;
    const charged = job.transaction && job.transaction.status !== "DRAFT" ? job.transaction.amountCents : null;

    return {
      jobCardId: job.id,
      title: job.title,
      customer: job.party.companyName ?? job.party.name,
      partyId: job.partyId,
      status: job.status,
      budgetCents: job.budgetCents,
      directCents: direct,
      labourCents: time.cents,
      subcontractCents: sub,
      spentCents: spent,
      remainingCents: job.budgetCents === null ? null : job.budgetCents - spent,
      usedPercent: job.budgetCents && job.budgetCents > 0 ? Math.round((spent / job.budgetCents) * 100) : null,
      hoursLogged: Math.round(time.hours * 10) / 10,
      chargedCents: charged,
      marginCents: charged === null ? null : charged - spent,
    };
  });
}

export async function setJobBudget(params: {
  tenantId: string;
  jobCardId: string;
  budgetCents?: number | null;
  subcontractorId?: string | null;
  subcontractCents?: number | null;
}) {
  const job = await prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } });
  if (!job) throw new Error("That job is not in this workspace.");
  if (params.subcontractorId) {
    const sub = await prisma.party.findFirst({
      where: { id: params.subcontractorId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!sub) throw new Error("That subcontractor is not in this workspace.");
  }

  return prisma.jobCard.update({
    where: { id: params.jobCardId },
    data: {
      ...(params.budgetCents !== undefined ? { budgetCents: params.budgetCents } : {}),
      ...(params.subcontractorId !== undefined ? { subcontractorId: params.subcontractorId } : {}),
      ...(params.subcontractCents !== undefined ? { subcontractCents: params.subcontractCents } : {}),
    },
  });
}

/**
 * Jobs running over, while somebody can still do something about it.
 *
 * The threshold is deliberately below 100: a job at 85% of its budget with
 * half the work left is the one worth a phone call, and one at 110% is
 * already a conversation about who pays.
 */
export async function jobsRunningOver(tenantId: string, atOrAbovePercent = 85) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const budgets = await jobBudgets(tenantId, { openOnly: true });

  const over = budgets
    .filter((b) => b.usedPercent !== null && b.usedPercent >= atOrAbovePercent)
    .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0));

  return {
    jobs: over,
    summary:
      over.length === 0
        ? "No open job is near its budget."
        : `${over.length} open ${over.length === 1 ? "job is" : "jobs are"} at or past ${atOrAbovePercent}% of budget, ` +
          `the worst being ${over[0].title} at ${over[0].usedPercent}% — ` +
          `${formatMoney(over[0].spentCents, tenant.currency)} spent against ${formatMoney(over[0].budgetCents ?? 0, tenant.currency)}.`,
  };
}

/**
 * Clock on to a job rather than to a day, so the hours can be costed.
 *
 * `at` exists for the offline queue: a shift captured on a phone at seven in
 * the morning and synced at four in the afternoon started at seven. Taking
 * the default would make every offline shift nine hours short — or, when the
 * clock-off arrives with its own real time, negative.
 */
export async function clockOntoJob(params: {
  tenantId: string;
  membershipId: string;
  jobCardId: string;
  notes?: string | null;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  const [job, open] = await Promise.all([
    prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true } }),
    prisma.timeEntry.findFirst({ where: { tenantId: params.tenantId, membershipId: params.membershipId, clockOutAt: null } }),
  ]);
  if (!job) throw new Error("That job is not in this workspace.");
  // Somebody already clocked on is moved rather than double-counted: two open
  // entries is the one state that makes every hour figure wrong. Closed at the
  // moment the new one starts, not now, or the two shifts overlap.
  if (open) await prisma.timeEntry.update({ where: { id: open.id }, data: { clockOutAt: at } });

  return prisma.timeEntry.create({
    data: {
      tenantId: params.tenantId,
      membershipId: params.membershipId,
      jobCardId: params.jobCardId,
      notes: params.notes?.trim() || null,
      clockInAt: at,
    },
  });
}

/** Where the hours on a job actually went, by person. */
export async function hoursOnJob(tenantId: string, jobCardId: string) {
  const entries = await prisma.timeEntry.findMany({
    where: { tenantId, jobCardId },
    orderBy: { clockInAt: "desc" },
    take: 200,
  });
  const memberIds = [...new Set(entries.map((e) => e.membershipId))];
  const members = await prisma.membership.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, costRateCents: true, user: { select: { name: true, email: true } } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));

  return entries.map((e) => {
    const member = byId.get(e.membershipId);
    const hours = e.clockOutAt ? (e.clockOutAt.getTime() - e.clockInAt.getTime()) / 3_600_000 : null;
    return {
      id: e.id,
      who: member ? member.user.name ?? member.user.email : "Somebody",
      from: e.clockInAt,
      to: e.clockOutAt,
      hours: hours === null ? null : Math.round(hours * 10) / 10,
      costCents: hours === null ? null : Math.round(hours * (member?.costRateCents ?? 0)),
      stillOn: e.clockOutAt === null,
    };
  });
}
