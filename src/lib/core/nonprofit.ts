// Non-profit/faith niche — membership involvement history, donations, and
// compliance filings. Built append-only: closing an involvement record
// sets endDate rather than deleting it, so "were you involved here, and
// when" is always answerable later.

import { prisma } from "@/lib/db";
import { InvolvementRole } from "@prisma/client";

export async function startInvolvement(params: {
  tenantId: string;
  partyId: string;
  role: InvolvementRole;
  startDate?: Date;
  notes?: string;
}) {
  return prisma.membershipInvolvement.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      role: params.role,
      startDate: params.startDate ?? new Date(),
      notes: params.notes,
    },
  });
}

export async function endInvolvement(involvementId: string, endDate: Date = new Date()) {
  return prisma.membershipInvolvement.update({
    where: { id: involvementId },
    data: { endDate },
  });
}

export async function getInvolvementHistory(tenantId: string, partyId: string) {
  return prisma.membershipInvolvement.findMany({
    where: { tenantId, partyId },
    orderBy: { startDate: "desc" },
  });
}

export async function listActiveInvolvements(tenantId: string) {
  const involvements = await prisma.membershipInvolvement.findMany({
    where: { tenantId, endDate: null },
    include: { party: true },
    orderBy: { startDate: "asc" },
  });
  return involvements;
}

export async function recordDonation(params: {
  tenantId: string;
  partyId: string;
  amountCents: number;
  designatedFund?: string;
  receiptNumber?: string;
  donatedAt?: Date;
}) {
  return prisma.donation.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      amountCents: params.amountCents,
      designatedFund: params.designatedFund,
      receiptNumber: params.receiptNumber,
      donatedAt: params.donatedAt ?? new Date(),
    },
  });
}

export async function listDonations(tenantId: string) {
  const donations = await prisma.donation.findMany({
    where: { tenantId },
    include: { party: true },
    orderBy: { donatedAt: "desc" },
  });
  return donations;
}

export async function totalDonationsByFund(tenantId: string) {
  const donations = await prisma.donation.findMany({ where: { tenantId } });
  const byFund = new Map<string, number>();
  for (const d of donations) {
    const key = d.designatedFund ?? "General";
    byFund.set(key, (byFund.get(key) ?? 0) + d.amountCents);
  }
  return Array.from(byFund.entries()).map(([fund, totalCents]) => ({ fund, totalCents }));
}

export async function addComplianceFiling(params: {
  tenantId: string;
  filingType: string;
  filingDate: Date;
  documentDataUrl?: string;
  notes?: string;
}) {
  return prisma.complianceFiling.create({ data: params });
}

export async function listComplianceFilings(tenantId: string) {
  return prisma.complianceFiling.findMany({
    where: { tenantId },
    orderBy: { filingDate: "desc" },
  });
}
