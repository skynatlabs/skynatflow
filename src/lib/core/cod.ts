// Cash on delivery, which is how this continent actually buys things.
//
// Two numbers decide whether a delivery business survives here, and neither
// of them appears anywhere in a normal set of books.
//
//   THE REJECTION RATE. Twenty to forty percent of cash-on-delivery parcels
//   are refused at the door. That does not read as a loss anywhere — it
//   reads as fuel, and as a delivery fee charged once for a job done three
//   times. The parcel comes back, the stock is fine, and the money quietly
//   went out of the business anyway.
//
//   THE FLOAT. A rider carries other people's money all day. Today that is
//   reconciled by counting a bag at a depot and hoping, and the gap between
//   what should be there and what is there is discovered — if ever — in a
//   monthly reconciliation nobody does.
//
// Both are the same shape as problems this codebase has already solved. A
// rider's bag is a till: an opening float, everything taken during the run,
// a physical count at the end, and the variance surfaced rather than
// absorbed. A refused delivery is a countable event, so a buyer who refuses
// half of what they order becomes a number rather than a feeling.
//
// ON SCORING BUYERS, AND BEING CAREFUL ABOUT IT.
//
// A reliability score is a judgement about a person, so it is computed only
// from that person's own history with this business, it needs a real number
// of orders before it says anything at all, and it is never shared between
// workspaces. A shared blacklist would be a far more valuable product and a
// far worse thing to build: it would follow somebody across businesses they
// have never dealt with, on evidence they cannot see or contest.

import { DeliveryNoteStatus, DeliveryOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Below this many deliveries a rate is noise, so nothing is reported. */
export const MIN_DELIVERIES_TO_SCORE = 4;

/** Open a rider's bag for the run. */
export async function openRiderBag(params: {
  tenantId: string;
  riderMembershipId: string;
  openingFloatCents?: number;
}) {
  const rider = await prisma.membership.findFirst({
    where: { id: params.riderMembershipId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!rider) throw new Error("That person is not on this team.");

  const open = await prisma.codSettlement.findFirst({
    where: {
      tenantId: params.tenantId,
      riderMembershipId: params.riderMembershipId,
      closedAt: null,
    },
    select: { id: true },
  });
  if (open) throw new Error("That rider already has a bag open — close it first.");

  return prisma.codSettlement.create({
    data: {
      tenantId: params.tenantId,
      riderMembershipId: params.riderMembershipId,
      openingFloatCents: Math.max(0, Math.round(params.openingFloatCents ?? 0)),
    },
  });
}

/** Hand a parcel to a rider, and the money it will collect with it. */
export async function assignToRider(params: {
  tenantId: string;
  deliveryNoteId: string;
  riderMembershipId: string;
  codAmountCents?: number | null;
}) {
  const [note, bag] = await Promise.all([
    prisma.deliveryNote.findFirst({
      where: { id: params.deliveryNoteId, tenantId: params.tenantId },
      select: { id: true },
    }),
    prisma.codSettlement.findFirst({
      where: {
        tenantId: params.tenantId,
        riderMembershipId: params.riderMembershipId,
        closedAt: null,
      },
      select: { id: true },
    }),
  ]);
  if (!note) throw new Error("Delivery note not found.");
  if (!bag) throw new Error("That rider has no bag open. Open one before handing out parcels.");

  return prisma.deliveryNote.update({
    where: { id: params.deliveryNoteId },
    data: {
      riderMembershipId: params.riderMembershipId,
      codSettlementId: bag.id,
      status: DeliveryNoteStatus.SENT,
      ...(params.codAmountCents === undefined
        ? {}
        : { codAmountCents: params.codAmountCents == null ? null : Math.round(params.codAmountCents) }),
    },
  });
}

export interface AttemptResult {
  attemptId: string;
  attemptNumber: number;
  outcome: DeliveryOutcome;
  collectedCents: number;
  /** Said plainly when money was expected and none came back. */
  note: string;
}

/**
 * Somebody tried.
 *
 * Every try is recorded, including the ones that failed — which is the whole
 * point, because the failed ones are the cost nobody counts. Only a
 * DELIVERED attempt closes the note; the rest leave it open for another go.
 */
export async function recordAttempt(params: {
  tenantId: string;
  deliveryNoteId: string;
  outcome: DeliveryOutcome;
  collectedCents?: number;
  riderMembershipId?: string | null;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
  at?: Date;
}): Promise<AttemptResult> {
  const note = await prisma.deliveryNote.findFirst({
    where: { id: params.deliveryNoteId, tenantId: params.tenantId },
  });
  if (!note) throw new Error("Delivery note not found.");

  const collected = Math.max(0, Math.round(params.collectedCents ?? 0));
  const delivered = params.outcome === DeliveryOutcome.DELIVERED;
  const at = params.at ?? new Date();

  if (!delivered && collected > 0) {
    throw new Error("Money cannot be collected on a delivery that did not happen.");
  }

  const attempt = await prisma.deliveryAttempt.create({
    data: {
      tenantId: params.tenantId,
      deliveryNoteId: params.deliveryNoteId,
      attemptedAt: at,
      outcome: params.outcome,
      collectedCents: delivered ? collected : null,
      riderMembershipId: params.riderMembershipId ?? note.riderMembershipId,
      lat: params.lat ?? null,
      lng: params.lng ?? null,
      note: params.note?.trim().slice(0, 300) || null,
    },
  });

  await prisma.deliveryNote.update({
    where: { id: params.deliveryNoteId },
    data: {
      attemptCount: { increment: 1 },
      ...(delivered
        ? {
            status: DeliveryNoteStatus.DELIVERED,
            deliveredAt: at,
            codCollectedCents: (note.codCollectedCents ?? 0) + collected,
          }
        : {}),
    },
  });

  const expected = note.codAmountCents ?? 0;
  const message = !delivered
    ? "Nothing was collected — the delivery did not happen."
    : expected === 0
      ? "Delivered. Nothing was due at the door."
      : collected === expected
        ? "Delivered and paid in full."
        : collected < expected
          ? `Delivered but short: ${((expected - collected) / 100).toFixed(2)} was not collected.`
          : `Delivered and overpaid by ${((collected - expected) / 100).toFixed(2)}.`;

  return {
    attemptId: attempt.id,
    attemptNumber: note.attemptCount + 1,
    outcome: params.outcome,
    collectedCents: delivered ? collected : 0,
    note: message,
  };
}

export interface BagClose {
  settlementId: string;
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  parcels: number;
  note: string;
}

/**
 * Count the bag back in.
 *
 * Expected is the float plus everything actually collected on this run, not
 * everything that was meant to be collected: a rider is answerable for money
 * they took, never for a customer who refused to pay.
 */
export async function closeRiderBag(params: {
  tenantId: string;
  settlementId: string;
  countedCents: number;
  closedById: string;
  at?: Date;
}): Promise<BagClose> {
  const bag = await prisma.codSettlement.findFirst({
    where: { id: params.settlementId, tenantId: params.tenantId },
    include: { notes: { select: { codCollectedCents: true } } },
  });
  if (!bag) throw new Error("Settlement not found.");
  if (bag.closedAt) throw new Error("That bag has already been closed.");

  const collected = bag.notes.reduce((sum, n) => sum + (n.codCollectedCents ?? 0), 0);
  const expected = bag.openingFloatCents + collected;
  const counted = Math.max(0, Math.round(params.countedCents));
  const variance = counted - expected;

  await prisma.codSettlement.update({
    where: { id: params.settlementId },
    data: {
      closedAt: params.at ?? new Date(),
      closedById: params.closedById,
      countedCents: counted,
      varianceCents: variance,
    },
  });

  return {
    settlementId: params.settlementId,
    expectedCents: expected,
    countedCents: counted,
    varianceCents: variance,
    parcels: bag.notes.length,
    note:
      variance === 0
        ? "Counted to the cent."
        : variance < 0
          ? `Short by ${(Math.abs(variance) / 100).toFixed(2)}.`
          : `Over by ${(variance / 100).toFixed(2)}.`,
  };
}

export interface FloatRow {
  settlementId: string;
  riderMembershipId: string;
  riderName: string;
  openedAt: Date;
  openingFloatCents: number;
  collectedCents: number;
  holdingCents: number;
  parcelsOut: number;
  parcelsDelivered: number;
  hoursOpen: number;
}

/**
 * Who is holding how much, right now.
 *
 * The number a depot manager wants at four in the afternoon and cannot get
 * from anything: how much of the business's money is currently in bags on
 * the road.
 */
export async function ridersHolding(tenantId: string, now = new Date()): Promise<FloatRow[]> {
  const bags = await prisma.codSettlement.findMany({
    where: { tenantId, closedAt: null },
    take: 200,
    include: {
      notes: { select: { codCollectedCents: true, status: true } },
    },
  });
  if (bags.length === 0) return [];

  const memberships = await prisma.membership.findMany({
    where: { tenantId, id: { in: bags.map((b) => b.riderMembershipId) } },
    select: { id: true, user: { select: { name: true, email: true } } },
    take: 200,
  });
  const nameOf = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));

  return bags
    .map((bag) => {
      const collected = bag.notes.reduce((sum, n) => sum + (n.codCollectedCents ?? 0), 0);
      return {
        settlementId: bag.id,
        riderMembershipId: bag.riderMembershipId,
        riderName: nameOf.get(bag.riderMembershipId) ?? "Someone",
        openedAt: bag.openedAt,
        openingFloatCents: bag.openingFloatCents,
        collectedCents: collected,
        holdingCents: bag.openingFloatCents + collected,
        parcelsOut: bag.notes.length,
        parcelsDelivered: bag.notes.filter((n) => n.status === DeliveryNoteStatus.DELIVERED).length,
        hoursOpen: Math.round((now.getTime() - bag.openedAt.getTime()) / 3_600_000),
      };
    })
    .sort((a, b) => b.holdingCents - a.holdingCents);
}

export interface ReliabilityRow {
  partyId: string;
  name: string;
  phone: string | null;
  delivered: number;
  refused: number;
  notHome: number;
  attempts: number;
  /** Deliveries that eventually landed, as a percentage of parcels sent. */
  successPercent: number;
  /** Tries per parcel. Two means every delivery is being done twice. */
  attemptsPerParcel: number;
}

/**
 * Who actually takes what they order.
 *
 * Computed only from this workspace's own history with this person, and only
 * once there is enough of it to mean anything. A score drawn on two orders
 * is a coin toss wearing a number.
 */
export async function buyerReliability(
  tenantId: string,
  opts: { sinceDays?: number; minDeliveries?: number } = {}
): Promise<ReliabilityRow[]> {
  const sinceDays = opts.sinceDays ?? 365;
  const min = opts.minDeliveries ?? MIN_DELIVERIES_TO_SCORE;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const notes = await prisma.deliveryNote.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: {
      partyId: true,
      status: true,
      attemptCount: true,
      party: { select: { name: true, phone: true } },
      attempts: { select: { outcome: true } },
    },
    take: 20000,
  });

  const byParty = new Map<string, ReliabilityRow & { parcels: number }>();

  for (const note of notes) {
    const row =
      byParty.get(note.partyId) ??
      ({
        partyId: note.partyId,
        name: note.party.name,
        phone: note.party.phone,
        delivered: 0,
        refused: 0,
        notHome: 0,
        attempts: 0,
        successPercent: 0,
        attemptsPerParcel: 0,
        parcels: 0,
      } as ReliabilityRow & { parcels: number });

    row.parcels += 1;
    row.attempts += note.attemptCount;
    if (note.status === DeliveryNoteStatus.DELIVERED) row.delivered += 1;
    for (const attempt of note.attempts) {
      if (attempt.outcome === DeliveryOutcome.REFUSED) row.refused += 1;
      if (attempt.outcome === DeliveryOutcome.NOT_HOME) row.notHome += 1;
    }

    byParty.set(note.partyId, row);
  }

  return [...byParty.values()]
    .filter((r) => r.parcels >= min)
    .map(({ parcels, ...r }) => ({
      ...r,
      successPercent: Math.round((r.delivered / parcels) * 100),
      attemptsPerParcel: Math.round((r.attempts / parcels) * 10) / 10,
    }))
    .sort((a, b) => a.successPercent - b.successPercent);
}

export interface CodPicture {
  outOnTheRoadCents: number;
  ridersOut: number;
  awaitingDelivery: number;
  /** Parcels tried more than once — the cost nobody counts. */
  redeliveries: number;
  refusedLast30: number;
  deliveredLast30: number;
  rejectionPercent: number;
  shortSettlementsCents: number;
  summary: string;
}

/** The one screen a depot needs. */
export async function codPicture(tenantId: string, now = new Date()): Promise<CodPicture> {
  const since = new Date(now.getTime() - 30 * 86_400_000);

  const [holding, awaiting, redeliveries, attempts, shortBags] = await Promise.all([
    ridersHolding(tenantId, now),
    prisma.deliveryNote.count({
      where: { tenantId, status: DeliveryNoteStatus.SENT },
    }),
    prisma.deliveryNote.count({
      where: { tenantId, attemptCount: { gt: 1 }, createdAt: { gte: since } },
    }),
    prisma.deliveryAttempt.groupBy({
      by: ["outcome"],
      where: { tenantId, attemptedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.codSettlement.aggregate({
      where: { tenantId, closedAt: { gte: since }, varianceCents: { lt: 0 } },
      _sum: { varianceCents: true },
    }),
  ]);

  const countOf = (outcome: DeliveryOutcome) =>
    attempts.find((a) => a.outcome === outcome)?._count._all ?? 0;

  const delivered = countOf(DeliveryOutcome.DELIVERED);
  const refused = countOf(DeliveryOutcome.REFUSED);
  const tried = attempts.reduce((sum, a) => sum + a._count._all, 0);

  return {
    outOnTheRoadCents: holding.reduce((sum, h) => sum + h.holdingCents, 0),
    ridersOut: holding.length,
    awaitingDelivery: awaiting,
    redeliveries,
    refusedLast30: refused,
    deliveredLast30: delivered,
    rejectionPercent: tried === 0 ? 0 : Math.round((refused / tried) * 100),
    shortSettlementsCents: Math.abs(shortBags._sum.varianceCents ?? 0),
    summary:
      tried === 0
        ? "No deliveries attempted in the last month."
        : `${delivered} delivered, ${refused} refused, ${redeliveries} parcels needed more than one trip.`,
  };
}
