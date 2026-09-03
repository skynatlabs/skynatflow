// Non-profit/faith niche — membership involvement history, donations, and
// compliance filings. Built append-only: closing an involvement record
// sets endDate rather than deleting it, so "were you involved here, and
// when" is always answerable later.

import { prisma } from "@/lib/db";
import { InvolvementRole } from "@prisma/client";
import { sendEmail } from "@/lib/email/client";

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

async function requireOwnedInvolvement(tenantId: string, involvementId: string) {
  const involvement = await prisma.membershipInvolvement.findUnique({ where: { id: involvementId } });
  if (!involvement || involvement.tenantId !== tenantId) throw new Error("Involvement record not found.");
  return involvement;
}

export async function endInvolvement(tenantId: string, involvementId: string, endDate: Date = new Date()) {
  await requireOwnedInvolvement(tenantId, involvementId);
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

export interface RenewalDue {
  involvementId: string;
  partyId: string;
  partyName: string;
  role: InvolvementRole;
  renewalDueAt: Date;
  daysUntilDue: number;
}

// PA job: who's about to lapse — the same "chase before it goes cold"
// instinct as the commercial follow-up engine, applied to membership
// renewals instead of unpaid quotes. Only involvements with an explicit
// renewalDueAt are considered — no assumed annual cadence, since real
// membership terms vary (see the schema comment on the field itself).
export async function checkMembershipRenewals(tenantId: string, withinDays = 14): Promise<RenewalDue[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86400000);

  const due = await prisma.membershipInvolvement.findMany({
    where: { tenantId, endDate: null, renewalDueAt: { not: null, lte: cutoff } },
    include: { party: true },
    orderBy: { renewalDueAt: "asc" },
  });

  return due.map((d) => ({
    involvementId: d.id,
    partyId: d.partyId,
    partyName: d.party.name,
    role: d.role,
    renewalDueAt: d.renewalDueAt!,
    daysUntilDue: Math.ceil((d.renewalDueAt!.getTime() - now.getTime()) / 86400000),
  }));
}

export async function setRenewalDueDate(tenantId: string, involvementId: string, renewalDueAt: Date) {
  await requireOwnedInvolvement(tenantId, involvementId);
  return prisma.membershipInvolvement.update({ where: { id: involvementId }, data: { renewalDueAt } });
}

export async function listActiveInvolvements(tenantId: string) {
  const involvements = await prisma.membershipInvolvement.findMany({
    where: { tenantId, endDate: null },
    include: { party: true },
    orderBy: { startDate: "asc" },
  });
  return involvements;
}

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

// PA job: a tax-ready receipt the instant a donation clears, instead of
// end-of-month batching a coordinator would otherwise do by hand.
// receiptNumber auto-generates (DON-<year>-<count>) when not supplied,
// and an email fires immediately if the donor has an address on file —
// silently skipped, not an error, if they don't (same graceful-
// degradation posture as every other outbound message in this app).
export async function recordDonation(params: {
  tenantId: string;
  partyId: string;
  amountCents: number;
  designatedFund?: string;
  receiptNumber?: string;
  donatedAt?: Date;
}) {
  const donatedAt = params.donatedAt ?? new Date();
  const year = donatedAt.getFullYear();

  let receiptNumber = params.receiptNumber;
  if (!receiptNumber) {
    const countThisYear = await prisma.donation.count({
      where: { tenantId: params.tenantId, donatedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
    });
    receiptNumber = `DON-${year}-${String(countThisYear + 1).padStart(4, "0")}`;
  }

  const donation = await prisma.donation.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      amountCents: params.amountCents,
      designatedFund: params.designatedFund,
      receiptNumber,
      donatedAt,
    },
  });

  const [party, tenant] = await Promise.all([
    prisma.party.findUnique({ where: { id: params.partyId } }),
    prisma.tenant.findUnique({ where: { id: params.tenantId } }),
  ]);

  if (party?.email && tenant) {
    await sendEmail({
      to: party.email,
      subject: `Your donation receipt — ${receiptNumber}`,
      html: `
        <p>Dear ${party.name},</p>
        <p>Thank you for your generous donation to <strong>${tenant.name}</strong>.</p>
        <ul>
          <li>Receipt number: <strong>${receiptNumber}</strong></li>
          <li>Amount: <strong>${money(donation.amountCents)}</strong></li>
          <li>Date: ${donatedAt.toLocaleDateString()}</li>
          ${params.designatedFund ? `<li>Designated fund: ${params.designatedFund}</li>` : ""}
        </ul>
        <p>Please keep this receipt for your tax records.</p>
      `,
    });
  }

  return donation;
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
