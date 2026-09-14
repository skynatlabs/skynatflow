// Insurance claim tracking — not a real payer/insurance API integration,
// just the difference between a denied claim quietly aging into a
// write-off (the research finding — nearly half of denials never get
// reworked) and one that's visibly tracked with an aging timer until it's
// actually resolved.

import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/agent/events";

export async function submitClaim(params: {
  tenantId: string;
  transactionId: string;
  payerName: string;
  claimedCents: number;
}) {
  return prisma.insuranceClaim.create({ data: params });
}

async function requireOwnedClaim(tenantId: string, claimId: string) {
  const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.tenantId !== tenantId) throw new Error("Claim not found.");
  return claim;
}

export async function markClaimDenied(tenantId: string, claimId: string, denialReason: string) {
  const claim = await requireOwnedClaim(tenantId, claimId);
  const updated = await prisma.insuranceClaim.update({
    where: { id: claimId },
    data: { status: "DENIED", denialReason },
  });

  // The whole reason this module exists: a denial that nobody reworks ages
  // quietly into a write-off. Raising it as an event is what puts a clock on
  // it, rather than trusting somebody to remember.
  await emitEvent({
    tenantId,
    type: "dispute.raised",
    subjectType: "InsuranceClaim",
    subjectId: claimId,
    payload: {
      payerName: claim.payerName,
      claimedCents: claim.claimedCents,
      denialReason,
    },
  });

  return updated;
}

export async function markClaimReworked(tenantId: string, claimId: string) {
  await requireOwnedClaim(tenantId, claimId);
  return prisma.insuranceClaim.update({ where: { id: claimId }, data: { status: "REWORKED" } });
}

export async function markClaimPaid(tenantId: string, claimId: string) {
  await requireOwnedClaim(tenantId, claimId);
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
    take: 200,
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

const CLAIMS_PAGE_SIZE = 25;

export async function listClaims(tenantId: string, page = 1) {
  const where = { tenantId };
  const [items, total] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * CLAIMS_PAGE_SIZE,
      take: CLAIMS_PAGE_SIZE,
    }),
    prisma.insuranceClaim.count({ where }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE)) };
}
