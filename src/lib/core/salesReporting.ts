// PA jobs built on top of the salesperson attribution that already exists
// on every Transaction (see money.ts createQuote/convertToInvoice): who
// should get the next lead, what everyone's actually closed, and a team
// digest an owner would otherwise have to compile by hand.

import { prisma } from "@/lib/db";

export interface SalesPersonLoad {
  membershipId: string;
  name: string;
  openQuoteCount: number;
}

// PA job: assign a new lead to whoever has the fewest open (SENT, not yet
// responded) quotes right now — balances by current load rather than
// "whoever happened to see it first." A suggestion for a human to accept
// or override, not an automatic assignment — see the ladder's own
// Manual/Copilot split for this job.
export async function suggestSalesPersonForNewLead(tenantId: string): Promise<SalesPersonLoad | null> {
  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    include: { user: true },
  });
  if (!memberships.length) return null;

  const openCounts = await prisma.transaction.groupBy({
    by: ["salesPersonMembershipId"],
    where: { tenantId, type: "QUOTE", status: "SENT", salesPersonMembershipId: { not: null } },
    _count: { _all: true },
  });
  const countByMembership = new Map(openCounts.map((c) => [c.salesPersonMembershipId, c._count._all]));

  const loads: SalesPersonLoad[] = memberships.map((m) => ({
    membershipId: m.id,
    name: m.user.name ?? m.user.email,
    openQuoteCount: countByMembership.get(m.id) ?? 0,
  }));

  return loads.sort((a, b) => a.openQuoteCount - b.openQuoteCount)[0];
}

export interface SalesPersonPerformance {
  membershipId: string;
  name: string;
  quotesSent: number;
  quotesAccepted: number;
  conversionRate: number; // 0-1, 0 when nothing sent yet
  revenueWonCents: number; // sum of ACCEPTED/converted-to-PAID quotes attributed to them
}

// PA job: the Monday-morning "who's converting, who's gone quiet" a
// manager would otherwise compile from memory — and the same numbers
// double as a commission rollup (revenueWonCents is exactly what a
// percentage-based commission would be calculated against).
export async function getTeamPerformance(tenantId: string, sinceDate?: Date): Promise<SalesPersonPerformance[]> {
  const memberships = await prisma.membership.findMany({ where: { tenantId }, include: { user: true } });

  const quotes = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: "QUOTE",
      salesPersonMembershipId: { not: null },
      createdAt: sinceDate ? { gte: sinceDate } : undefined,
    },
    select: { salesPersonMembershipId: true, status: true, amountCents: true },
  });

  return memberships
    .map((m) => {
      const mine = quotes.filter((q) => q.salesPersonMembershipId === m.id);
      const accepted = mine.filter((q) => q.status === "ACCEPTED" || q.status === "PAID" || q.status === "PARTIALLY_PAID");
      return {
        membershipId: m.id,
        name: m.user.name ?? m.user.email,
        quotesSent: mine.length,
        quotesAccepted: accepted.length,
        conversionRate: mine.length ? accepted.length / mine.length : 0,
        revenueWonCents: accepted.reduce((sum, q) => sum + q.amountCents, 0),
      };
    })
    .filter((p) => p.quotesSent > 0)
    .sort((a, b) => b.revenueWonCents - a.revenueWonCents);
}
