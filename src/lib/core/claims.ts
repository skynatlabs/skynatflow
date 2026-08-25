// Insurance claim tracking — not a real payer/insurance API integration,
// just the difference between a denied claim quietly aging into a
// write-off (the research finding — nearly half of denials never get
// reworked) and one that's visibly tracked with an aging timer until it's
// actually resolved.

import { prisma } from "@/lib/db";

export async function submitClaim(params: {
  tenantId: string;
  transactionId: string;
  payerName: string;
  claimedCents: number;
}) {
  return prisma.insuranceClaim.create({ data: params });
}

export async function markClaimDenied(claimId: string, denialReason: string) {
  return prisma.insuranceClaim.update({
    where: { id: claimId },
    data: { status: "DENIED", denialReason },
  });
}

export async function markClaimReworked(claimId: string) {
  return prisma.insuranceClaim.update({ where: { id: claimId }, data: { status: "REWORKED" } });
}

export async function markClaimPaid(claimId: string) {
  return prisma.insuranceClaim.update({
    where: { id: claimId },
    data: { status: "PAID", resolvedAt: new Date() },
  });
}

export interface AgingDenial {
  claimId: string;
  payerName: string;
  claimedCents: number;
  denialReason: string | null;
  daysAging: number;
}

// The exact fix for "denied claims quietly written off" — every DENIED
// claim not yet reworked, oldest first, with how long it's been sitting.
export async function getAgingDenials(tenantId: string): Promise<AgingDenial[]> {
  const denials = await prisma.insuranceClaim.findMany({
    where: { tenantId, status: "DENIED" },
    orderBy: { submittedAt: "asc" },
  });

  const now = Date.now();
  return denials.map((d) => ({
    claimId: d.id,
    payerName: d.payerName,
    claimedCents: d.claimedCents,
    denialReason: d.denialReason,
    daysAging: Math.floor((now - d.submittedAt.getTime()) / 86400000),
  }));
}

export async function listClaims(tenantId: string) {
  return prisma.insuranceClaim.findMany({ where: { tenantId }, orderBy: { submittedAt: "desc" } });
}
