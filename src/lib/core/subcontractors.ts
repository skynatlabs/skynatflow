// Work put out to somebody else.
//
// A subcontractor is the one cost that reliably escapes a small business's
// books. The job is quoted at a margin, half of it is handed to a man with a
// bakkie at a price agreed over the phone, his invoice arrives three weeks
// later, and by then nobody can say which job it was for. The margin on that
// job is a guess for ever.
//
// So the price is captured when the work is handed over, not when the invoice
// arrives — and the two are matched afterwards rather than the other way
// round. That single ordering is the whole of what makes subcontracted work
// costable.
//
// What this deliberately does not do: run a second portal for subcontractors
// with its own logins and permissions. A subcontractor gets the same portal
// link a customer gets, showing the one job they are on. A separate access
// system for people outside the business is a security surface that earns
// nothing.

import { prisma } from "@/lib/db";
import { getOrCreatePortalToken } from "./parties";
import { formatMoney } from "@/lib/format/money";
import { tenantCurrency } from "./currency";
import { baseUrlWithoutRequest } from "@/lib/appUrl";

export interface HandoverResult {
  jobCardId: string;
  subcontractor: string;
  agreedCents: number;
  /** The link to send them. */
  portalUrl: string;
  note: string;
}

/**
 * Hand a job to a subcontractor at an agreed price.
 *
 * The price is required. A handover without one is the exact hole this module
 * exists to close, and accepting a null here would reopen it politely.
 */
export async function handOver(params: {
  tenantId: string;
  jobCardId: string;
  subcontractorId: string;
  agreedCents: number;
  scope?: string;
}): Promise<HandoverResult> {
  if (!Number.isFinite(params.agreedCents) || params.agreedCents <= 0) {
    throw new Error("What are they being paid? A handover without a price is the reason subcontracted jobs have no margin.");
  }

  const [job, party] = await Promise.all([
    prisma.jobCard.findFirst({ where: { id: params.jobCardId, tenantId: params.tenantId }, select: { id: true, title: true, notes: true } }),
    prisma.party.findFirst({ where: { id: params.subcontractorId, tenantId: params.tenantId }, select: { id: true, name: true, companyName: true, role: true } }),
  ]);
  if (!job) throw new Error("That job is not in this workspace.");
  if (!party) throw new Error("That subcontractor is not in this workspace.");

  await prisma.jobCard.update({
    where: { id: job.id },
    data: {
      subcontractorId: party.id,
      subcontractCents: params.agreedCents,
      notes: params.scope ? [job.notes, `Subcontracted: ${params.scope}`].filter(Boolean).join("\n") : job.notes,
    },
  });

  const token = await getOrCreatePortalToken(party.id);
  const base = baseUrlWithoutRequest();

  return {
    jobCardId: job.id,
    subcontractor: party.companyName ?? party.name,
    agreedCents: params.agreedCents,
    portalUrl: `${base}/portal/${token}`,
    note: "They see this job and nothing else about the business. It is the same portal link a customer gets, which is why there is no second login to manage.",
  };
}

export interface SubcontractorRow {
  partyId: string;
  name: string;
  jobs: number;
  agreedCents: number;
  /** What they have actually invoiced, matched by supplier. */
  invoicedCents: number;
  /** Agreed but not yet invoiced. The liability nobody sees coming. */
  outstandingCents: number;
  /** Where an invoice does not match what was agreed. */
  disagreements: Array<{ jobTitle: string; agreedCents: number; invoicedCents: number; note: string }>;
}

/**
 * What is owed to the people doing work for us.
 *
 * The outstanding figure is the one that matters and the one no small
 * business has: work already handed over, already done, not yet invoiced, and
 * therefore entirely absent from the cash forecast until the invoice lands.
 */
export async function subcontractorPosition(tenantId: string, since: Date): Promise<{ rows: SubcontractorRow[]; note: string }> {
  const currency = await tenantCurrency(tenantId);
  const jobs = await prisma.jobCard.findMany({
    where: { tenantId, subcontractorId: { not: null }, createdAt: { gte: since } },
    select: {
      id: true,
      title: true,
      subcontractorId: true,
      subcontractCents: true,
      status: true,
      subcontractor: { select: { id: true, name: true, companyName: true } },
    },
    take: 500,
  });

  const byParty = new Map<string, SubcontractorRow>();

  for (const job of jobs) {
    if (!job.subcontractorId || !job.subcontractor) continue;

    const row =
      byParty.get(job.subcontractorId) ??
      ({
        partyId: job.subcontractorId,
        name: job.subcontractor.companyName ?? job.subcontractor.name,
        jobs: 0,
        agreedCents: 0,
        invoicedCents: 0,
        outstandingCents: 0,
        disagreements: [],
      } satisfies SubcontractorRow);

    row.jobs += 1;
    row.agreedCents += job.subcontractCents ?? 0;
    byParty.set(job.subcontractorId, row);
  }

  // What each of them has actually billed. Matched on the supplier rather
  // than per job, because a subcontractor's invoice routinely covers three
  // jobs and nobody splits it.
  for (const row of byParty.values()) {
    const billed = await prisma.expense.aggregate({
      where: { tenantId, supplierId: row.partyId, status: { notIn: ["REJECTED", "DUPLICATE"] }, spentOn: { gte: since } },
      _sum: { amountCents: true },
    });
    row.invoicedCents = billed._sum.amountCents ?? 0;
    row.outstandingCents = Math.max(0, row.agreedCents - row.invoicedCents);

    // Billed more than was agreed, which is the argument worth having early.
    if (row.invoicedCents > row.agreedCents * 1.05 && row.agreedCents > 0) {
      row.disagreements.push({
        jobTitle: "Across all their jobs",
        agreedCents: row.agreedCents,
        invoicedCents: row.invoicedCents,
        note: "They have invoiced more than was agreed. Worth settling now rather than at year end.",
      });
    }
  }

  const rows = [...byParty.values()].sort((a, b) => b.outstandingCents - a.outstandingCents);
  const outstanding = rows.reduce((sum, row) => sum + row.outstandingCents, 0);

  return {
    rows,
    note:
      rows.length === 0
        ? "No work has been subcontracted in this period."
        : outstanding > 0
          ? `${formatMoney(outstanding, currency, { decimals: true })} of work has been handed over and not yet invoiced back. None of it is in the cash forecast until it arrives.`
          : "Everything handed over has been invoiced.",
  };
}

/**
 * What a subcontracted job actually made.
 *
 * Separated from ordinary job margin because the shape is different: there
 * are no hours and no materials, only the gap between what the customer pays
 * and what the subcontractor is paid — and a job that has been handed over
 * whole should be judged on that gap alone.
 */
export async function subcontractMargins(tenantId: string, since: Date) {
  const jobs = await prisma.jobCard.findMany({
    where: { tenantId, subcontractorId: { not: null }, createdAt: { gte: since } },
    select: {
      id: true,
      title: true,
      subcontractCents: true,
      subcontractor: { select: { name: true, companyName: true } },
      transaction: { select: { amountCents: true, status: true } },
    },
    take: 300,
  });

  const rows = jobs
    .map((job) => {
      const revenue = job.transaction?.amountCents ?? 0;
      const cost = job.subcontractCents ?? 0;
      const margin = revenue - cost;
      return {
        jobId: job.id,
        title: job.title,
        who: job.subcontractor?.companyName ?? job.subcontractor?.name ?? "Unknown",
        revenueCents: revenue,
        costCents: cost,
        marginCents: margin,
        marginPercent: revenue > 0 ? Math.round((margin / revenue) * 100) : 0,
        note:
          revenue === 0
            ? "Not invoiced to the customer yet, so there is nothing to compare the cost to."
            : margin <= 0
              ? "This job was handed over for more than the customer is paying."
              : null,
      };
    })
    .sort((a, b) => a.marginPercent - b.marginPercent);

  const priced = rows.filter((row) => row.revenueCents > 0);
  const average = priced.length > 0 ? Math.round(priced.reduce((sum, row) => sum + row.marginPercent, 0) / priced.length) : null;

  return {
    rows,
    averagePercent: average,
    note:
      priced.length === 0
        ? "No subcontracted job has been invoiced yet."
        : `${average}% average on subcontracted work across ${priced.length} ${priced.length === 1 ? "job" : "jobs"}. Anything below about 15% is worth asking whether it is worth taking on at all.`,
  };
}
