// Contracts that raise their own work.
//
// A signed maintenance agreement is a promise to turn up, and the business
// that forgets to turn up is in breach of a document it wrote itself. Every
// small business with retainers manages this in a diary, and the diary is the
// first thing to go when a month gets busy.
//
// So a signed retainer creates its own job cards, one period ahead, and the
// invoice is the one the recurring engine already raises. Two rules:
//
//   ONE AHEAD, NOT TWELVE. Raising a year of jobs on signing fills the board
//   with work nobody will look at for months and makes the capacity figure
//   meaningless. The next one appears when the last is done or its month
//   arrives.
//
//   IT STOPS WHEN THE CONTRACT DOES. An agreement that has ended, been
//   cancelled or lapsed raises nothing, and a job already raised for a period
//   that has been cancelled is left alone rather than deleted — somebody may
//   have done the work.

import { AgreementState, JobCardStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseClauses } from "./agreements";

export interface DueVisit {
  agreementId: string;
  number: string;
  title: string;
  partyId: string;
  customer: string;
  dueOn: Date;
  /** Already on the board. */
  jobCardId: string | null;
}

function monthsBetween(recurrence: string | null): number {
  switch (recurrence) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "annually":
      return 12;
    default:
      return 1;
  }
}

/**
 * When the next visit under this agreement falls.
 *
 * Counted from the start date rather than from the last visit, so a month
 * somebody was late does not push every subsequent month late with it.
 */
export function nextVisitDate(params: { startsAt: Date; recurrence: string | null; after: Date }): Date {
  const step = monthsBetween(params.recurrence);
  const next = new Date(params.startsAt);
  while (next <= params.after) next.setMonth(next.getMonth() + step);
  return next;
}

/** Live retainers, and when each is next due. */
export async function dueVisits(tenantId: string, within = 45, now = new Date()): Promise<DueVisit[]> {
  const horizon = new Date(now.getTime() + within * 86_400_000);
  const agreements = await prisma.agreement.findMany({
    where: {
      tenantId,
      kind: "RETAINER",
      status: AgreementState.SIGNED,
      startsAt: { not: null },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });

  const out: DueVisit[] = [];
  for (const agreement of agreements) {
    if (!agreement.startsAt) continue;
    const dueOn = nextVisitDate({ startsAt: agreement.startsAt, recurrence: agreement.recurrence, after: now });
    if (dueOn > horizon) continue;
    if (agreement.endsAt && dueOn > agreement.endsAt) continue;

    // One job per period: the same agreement in the same month is the same
    // visit, however many times this runs.
    const monthStart = new Date(Date.UTC(dueOn.getUTCFullYear(), dueOn.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(dueOn.getUTCFullYear(), dueOn.getUTCMonth() + 1, 1));
    const existing = await prisma.jobCard.findFirst({
      where: {
        tenantId,
        partyId: agreement.partyId,
        title: { contains: agreement.number },
        scheduledAt: { gte: monthStart, lt: monthEnd },
      },
      select: { id: true },
    });

    out.push({
      agreementId: agreement.id,
      number: agreement.number,
      title: agreement.title,
      partyId: agreement.partyId,
      customer: agreement.party.companyName ?? agreement.party.name,
      dueOn,
      jobCardId: existing?.id ?? null,
    });
  }

  return out.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime());
}

/**
 * Put the due visits on the board.
 *
 * The job carries the agreement's number in its title, which is both how a
 * technician knows what it is for and how this function knows not to raise it
 * twice. The scope clause becomes the job's notes, so whoever turns up is
 * reading what was actually promised rather than guessing.
 */
export async function raiseDueVisits(tenantId: string, now = new Date()): Promise<{ raised: number; visits: DueVisit[] }> {
  const due = (await dueVisits(tenantId, 45, now)).filter((v) => v.jobCardId === null);
  const raised: DueVisit[] = [];

  for (const visit of due) {
    const agreement = await prisma.agreement.findUnique({ where: { id: visit.agreementId } });
    if (!agreement) continue;

    // A job card needs a document to hang off. The agreement is not one, so
    // the most recent invoice to this customer stands in — and where there is
    // none, the visit waits rather than inventing an invoice nobody raised.
    const document = await prisma.transaction.findFirst({
      where: { tenantId, partyId: visit.partyId, type: { in: ["INVOICE", "QUOTE"] }, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!document) continue;

    const scope = parseClauses(agreement.clauses).find((c) => /covered|scope|work/i.test(c.heading));
    const job = await prisma.jobCard.create({
      data: {
        tenantId,
        transactionId: document.id,
        partyId: visit.partyId,
        title: `${visit.number} · ${visit.title}`,
        status: JobCardStatus.SCHEDULED,
        scheduledAt: visit.dueOn,
        notes: scope ? `${scope.heading}\n${scope.body}` : null,
      },
    });
    raised.push({ ...visit, jobCardId: job.id });
  }

  return { raised: raised.length, visits: raised };
}

/** Retainers that have run past their end date and nobody has renewed. */
export async function lapsedRetainers(tenantId: string, now = new Date()) {
  const rows = await prisma.agreement.findMany({
    where: { tenantId, kind: "RETAINER", status: AgreementState.SIGNED, endsAt: { not: null, lt: now } },
    include: { party: { select: { id: true, name: true, companyName: true } } },
    orderBy: { endsAt: "desc" },
    take: 50,
  });

  return rows.map((a) => ({
    agreementId: a.id,
    number: a.number,
    title: a.title,
    customer: a.party.companyName ?? a.party.name,
    partyId: a.partyId,
    endedOn: a.endsAt!,
    daysAgo: Math.floor((now.getTime() - a.endsAt!.getTime()) / 86_400_000),
    valueCents: a.valueCents,
  }));
}

/** What the retainers are worth, and whether they are being honoured. */
export async function retainerHealth(tenantId: string, now = new Date()) {
  const [live, due, lapsed] = await Promise.all([
    prisma.agreement.findMany({
      where: {
        tenantId,
        kind: "RETAINER",
        status: AgreementState.SIGNED,
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      select: { valueCents: true, recurrence: true },
    }),
    dueVisits(tenantId, 45, now),
    lapsedRetainers(tenantId, now),
  ]);

  // Everything normalised to a month, because "R4 500 a quarter" and "R1 500
  // a month" are the same revenue and a business thinks in months.
  const monthlyCents = live.reduce((s, a) => s + Math.round((a.valueCents ?? 0) / monthsBetween(a.recurrence)), 0);
  const overdue = due.filter((v) => v.dueOn < now && v.jobCardId === null);

  return {
    live: live.length,
    monthlyCents,
    dueSoon: due.length,
    notYetOnTheBoard: due.filter((v) => v.jobCardId === null).length,
    overdueVisits: overdue.length,
    lapsed: lapsed.length,
    summary:
      live.length === 0
        ? "No maintenance agreements are running."
        : `${live.length} maintenance ${live.length === 1 ? "agreement" : "agreements"} worth about ${Math.round(monthlyCents / 100)} a month` +
          (overdue.length > 0 ? `, and ${overdue.length} ${overdue.length === 1 ? "visit is" : "visits are"} past due.` : ".") +
          (lapsed.length > 0 ? ` ${lapsed.length} lapsed and nobody has renewed ${lapsed.length === 1 ? "it" : "them"}.` : ""),
  };
}
