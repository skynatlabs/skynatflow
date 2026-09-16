// Progress claims and retention.
//
// A trade agrees R2,400,000 for a job, bills 30% when the slab is down, 60%
// when the roof is on, and the customer holds 10% of each claim back until
// the defects period expires six months after completion. That held-back
// money is the operator's profit, it is entirely legitimate, and it goes
// uncollected constantly — because nothing reminds anybody it exists once the
// job is off the board and the site is a memory.
//
// So retention is not modelled as a number in a column here. When a job
// completes it becomes a dated obligation with a consequence, which puts it
// on the same radar as a lapsing licence and chases itself.

import { prisma } from "@/lib/db";
import { AgreementStatus } from "@prisma/client";
import { addObligation } from "./obligations";
import { tenantCurrency } from "./currency";
import { formatMoney } from "@/lib/format/money";

export interface CreateAgreementParams {
  tenantId: string;
  partyId: string;
  title: string;
  totalValueCents: number;
  retentionPercent?: number;
  retentionDueAt?: Date | null;
  notes?: string | null;
}

export async function createAgreement(params: CreateAgreementParams) {
  const party = await prisma.party.findUnique({
    where: { id: params.partyId },
    select: { tenantId: true },
  });
  if (!party || party.tenantId !== params.tenantId) throw new Error("Customer not found.");
  if (params.totalValueCents <= 0) throw new Error("The job needs a value.");

  const retention = params.retentionPercent ?? 0;
  if (retention < 0 || retention >= 100) {
    throw new Error("Retention has to be between 0 and 100 percent.");
  }

  return prisma.progressAgreement.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      title: params.title.trim(),
      totalValueCents: params.totalValueCents,
      retentionPercent: retention,
      retentionDueAt: params.retentionDueAt ?? null,
      notes: params.notes?.trim() || null,
    },
  });
}

export interface ClaimBreakdown {
  sequence: number;
  /** Cumulative percentage this claim asserts. */
  percentComplete: number;
  /** Value of the whole job completed to date. */
  cumulativeGrossCents: number;
  /** This claim alone. */
  grossCents: number;
  retentionCents: number;
  netCents: number;
  /** Retention held across every claim including this one. */
  retentionHeldToDateCents: number;
}

/**
 * Work out what a claim is worth, without writing anything.
 *
 * Exists separately so a claim can be shown before it is raised — this is a
 * number people check against a quantity surveyor's figure, and being able to
 * see it first is the difference between a tool they trust and one they
 * double-check on paper anyway.
 */
export async function previewClaim(params: {
  tenantId: string;
  agreementId: string;
  percentComplete: number;
}): Promise<ClaimBreakdown> {
  const agreement = await prisma.progressAgreement.findUnique({
    where: { id: params.agreementId },
    include: { claims: { orderBy: { sequence: "asc" } } },
  });
  if (!agreement || agreement.tenantId !== params.tenantId) {
    throw new Error("Agreement not found.");
  }

  const previous = agreement.claims;
  const lastPercent = previous.length > 0 ? previous[previous.length - 1].percentComplete : 0;

  if (params.percentComplete <= lastPercent) {
    throw new Error(
      `This job is already claimed to ${lastPercent}%. A claim has to go further than the last one.`
    );
  }
  if (params.percentComplete > 100) throw new Error("A job cannot be more than 100% complete.");

  // Cumulative, then subtract what has already been claimed. Doing it this way
  // round means rounding never accumulates: the final claim always brings the
  // total to exactly the agreed value, however the percentages fell.
  const cumulativeGrossCents = Math.round(
    (agreement.totalValueCents * params.percentComplete) / 100
  );
  const alreadyClaimed = previous.reduce((sum, c) => sum + c.grossCents, 0);
  const grossCents = cumulativeGrossCents - alreadyClaimed;

  const retentionCents = Math.round((grossCents * agreement.retentionPercent) / 100);
  const netCents = grossCents - retentionCents;
  const retentionHeldToDateCents =
    previous.reduce((sum, c) => sum + c.retentionCents, 0) + retentionCents;

  return {
    sequence: previous.length + 1,
    percentComplete: params.percentComplete,
    cumulativeGrossCents,
    grossCents,
    retentionCents,
    netCents,
    retentionHeldToDateCents,
  };
}

export interface RaiseClaimResult {
  claimId: string;
  breakdown: ClaimBreakdown;
  /** Set when this claim completed the job and retention is now being tracked. */
  retentionObligationId: string | null;
}

/**
 * Raise a claim.
 *
 * When a claim takes the job to 100%, the agreement becomes COMPLETE and the
 * accumulated retention becomes an obligation with a real date — because that
 * is the moment everybody stops thinking about the job, and the moment the
 * money is most likely to be forgotten.
 */
export async function raiseClaim(params: {
  tenantId: string;
  agreementId: string;
  percentComplete: number;
  invoiceId?: string | null;
}): Promise<RaiseClaimResult> {
  const breakdown = await previewClaim(params);

  const agreement = await prisma.progressAgreement.findUniqueOrThrow({
    where: { id: params.agreementId },
  });

  const claim = await prisma.progressClaim.create({
    data: {
      tenantId: params.tenantId,
      agreementId: params.agreementId,
      sequence: breakdown.sequence,
      percentComplete: breakdown.percentComplete,
      grossCents: breakdown.grossCents,
      retentionCents: breakdown.retentionCents,
      netCents: breakdown.netCents,
      invoiceId: params.invoiceId ?? null,
    },
  });

  let retentionObligationId: string | null = null;

  if (breakdown.percentComplete >= 100) {
    await prisma.progressAgreement.update({
      where: { id: agreement.id },
      data: { status: AgreementStatus.COMPLETE },
    });

    if (breakdown.retentionHeldToDateCents > 0) {
      const party = await prisma.party.findUnique({
        where: { id: agreement.partyId },
        select: { name: true },
      });

      // A default defects period where none was agreed. Six months is the
      // common convention, and a date that is roughly right and visible beats
      // no date at all — which is the status quo it is replacing.
      const dueAt =
        agreement.retentionDueAt ??
        new Date(Date.now() + 182 * 24 * 60 * 60 * 1000);

      const obligation = await addObligation({
        tenantId: params.tenantId,
        kind: "CONTRACT",
        title: `Retention release — ${agreement.title}`,
        authority: party?.name ?? null,
        dueAt,
        severity: "HIGH",
        leadDays: 30,
        partyId: agreement.partyId,
        consequence:
          `${formatMoney(breakdown.retentionHeldToDateCents, await tenantCurrency(params.tenantId))} of your money is being held. Nobody will remind you it is owed, and ` +
          `it is usually forgotten once the site is finished.`,
      });
      retentionObligationId = obligation.id;
    }
  }

  return { claimId: claim.id, breakdown, retentionObligationId };
}

export interface AgreementPosition {
  agreementId: string;
  title: string;
  customer: string;
  totalValueCents: number;
  claimedGrossCents: number;
  /** Value of work agreed but not yet claimed. */
  remainingCents: number;
  percentComplete: number;
  retentionHeldCents: number;
  retentionDueAt: Date | null;
  status: AgreementStatus;
  claims: number;
}

export async function agreementPositions(tenantId: string): Promise<AgreementPosition[]> {
  const agreements = await prisma.progressAgreement.findMany({
    where: { tenantId },
    include: {
      party: { select: { name: true } },
      claims: { orderBy: { sequence: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return agreements.map((a) => {
    const claimedGrossCents = a.claims.reduce((s, c) => s + c.grossCents, 0);
    const retentionHeldCents = a.claims.reduce((s, c) => s + c.retentionCents, 0);
    const last = a.claims[a.claims.length - 1];

    return {
      agreementId: a.id,
      title: a.title,
      customer: a.party.name,
      totalValueCents: a.totalValueCents,
      claimedGrossCents,
      remainingCents: a.totalValueCents - claimedGrossCents,
      percentComplete: last?.percentComplete ?? 0,
      retentionHeldCents,
      retentionDueAt: a.retentionDueAt,
      status: a.status,
      claims: a.claims.length,
    };
  });
}

export interface RetentionSummary {
  totalHeldCents: number;
  /** Retention on jobs finished, so already payable or becoming payable. */
  onCompleteJobsCents: number;
  agreements: number;
  summary: string;
}

/**
 * How much of the operator's money other people are holding.
 *
 * Almost nobody in this trade can answer this, and it is frequently a
 * material number — often more than a month's profit.
 */
export async function retentionHeld(tenantId: string): Promise<RetentionSummary> {
  const positions = await agreementPositions(tenantId);
  const live = positions.filter((p) => p.status !== "SETTLED" && p.status !== "CANCELLED");

  const totalHeldCents = live.reduce((s, p) => s + p.retentionHeldCents, 0);
  const onCompleteJobsCents = live
    .filter((p) => p.status === "COMPLETE")
    .reduce((s, p) => s + p.retentionHeldCents, 0);

  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);

  let summary = "";
  if (totalHeldCents > 0) {
    summary = `${money(totalHeldCents)} of your money is being held as retention`;
    summary +=
      onCompleteJobsCents > 0
        ? `, ${money(onCompleteJobsCents)} of it on jobs already finished.`
        : ".";
  }

  return {
    totalHeldCents,
    onCompleteJobsCents,
    agreements: live.filter((p) => p.retentionHeldCents > 0).length,
    summary,
  };
}

/** Mark retention as received, closing the job out properly. */
export async function settleRetention(params: { tenantId: string; agreementId: string }) {
  const agreement = await prisma.progressAgreement.findUnique({
    where: { id: params.agreementId },
    select: { tenantId: true, status: true },
  });
  if (!agreement || agreement.tenantId !== params.tenantId) throw new Error("Agreement not found.");
  if (agreement.status !== AgreementStatus.COMPLETE) {
    throw new Error("The job isn't finished yet — there is nothing to settle.");
  }

  return prisma.progressAgreement.update({
    where: { id: params.agreementId },
    data: { status: AgreementStatus.SETTLED },
  });
}
