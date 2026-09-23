// The shops a rep calls on, and proof that they were called on.
//
// Field sales in most of the world is a route plan and a CRM. In African
// trade it is a person walking a township with a phone, and the two things
// that decide whether the software is worth anything are both unglamorous:
//
//   IT HAS TO WORK WITHOUT SIGNAL. A rep loses the network between the third
//   and the eleventh shop. Anything that needs a round trip to record a
//   visit records no visits. So a visit is written where it happens and the
//   existing offline queue carries it, rather than this module inventing a
//   second way to be offline.
//
//   THE VISIT HAS TO BE PROVABLE. A visit report typed up at home is worth
//   nothing to the brand paying for the route, and everybody involved knows
//   it. A coordinate taken at the door is the entire reason distributor
//   management gets bought, and it is the one thing an imported system
//   cannot fake its way into.
//
// ON VERIFICATION, AND NOT TURNING IT INTO AN ACCUSATION.
//
// A visit is flagged unverified when the phone was further from the shop's
// pin than it should have been. That is not proof a rep lied. Pins get
// recorded from the wrong side of a road, a shop inside a mall has no GPS at
// all, and a phone with a weak fix can report a kilometre of error while
// sitting still. So the distance is recorded, the flag is computed, and a
// person decides — the software never says somebody cheated.
//
// WHERE A SHOP IS, WHEN THERE IS NO ADDRESS.
//
// The landmark field is not a nicety. Most outlets here have no street
// address that means anything, and "after the blue mosque, third gate" is
// how every delivery actually arrives. Imported systems have a street line
// and a postcode and nowhere to put the sentence a driver needs.

import { VisitOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { haversineKm } from "./trips";

/**
 * How close counts as being there.
 *
 * 150 metres. A consumer phone in a dense township gets 20–50m on a good
 * fix and considerably worse between buildings, so a tighter radius flags
 * honest reps and a looser one flags nobody at all.
 */
export const VERIFY_RADIUS_METRES = 150;

export interface OutletInput {
  tenantId: string;
  partyId: string;
  code?: string | null;
  channel?: string | null;
  tier?: string | null;
  lat?: number | null;
  lng?: number | null;
  landmark?: string | null;
  visitFrequencyDays?: number | null;
  routeId?: string | null;
  isActive?: boolean;
}

/** Put a customer on the trade map, or update where they are on it. */
export async function saveOutlet(input: OutletInput) {
  const party = await prisma.party.findFirst({
    where: { id: input.partyId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!party) throw new Error("That customer is not in this workspace.");

  if (input.routeId) {
    const route = await prisma.salesRoute.findFirst({
      where: { id: input.routeId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!route) throw new Error("That route is not in this workspace.");
  }

  const data = {
    code: input.code?.trim() || null,
    channel: input.channel?.trim() || null,
    tier: input.tier?.trim().toUpperCase().slice(0, 4) || null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    landmark: input.landmark?.trim().slice(0, 300) || null,
    visitFrequencyDays:
      input.visitFrequencyDays == null ? null : Math.max(1, Math.round(input.visitFrequencyDays)),
    routeId: input.routeId ?? null,
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };

  return prisma.outlet.upsert({
    where: { partyId: input.partyId },
    create: { tenantId: input.tenantId, partyId: input.partyId, ...data },
    update: data,
  });
}

export async function listOutlets(
  tenantId: string,
  opts: { routeId?: string; channel?: string; activeOnly?: boolean } = {}
) {
  return prisma.outlet.findMany({
    where: {
      tenantId,
      ...(opts.routeId ? { routeId: opts.routeId } : {}),
      ...(opts.channel ? { channel: opts.channel } : {}),
      ...(opts.activeOnly === false ? {} : { isActive: true }),
    },
    orderBy: [{ tier: "asc" }, { lastVisitAt: "asc" }],
    take: 1000,
    include: { party: { select: { name: true, phone: true, addressLine: true, city: true } } },
  });
}

export async function saveRoute(params: {
  tenantId: string;
  routeId?: string;
  name: string;
  membershipId?: string | null;
  dayOfWeek?: number | null;
  isActive?: boolean;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("A route needs a name.");

  const day =
    params.dayOfWeek == null ? null : Math.min(7, Math.max(1, Math.round(params.dayOfWeek)));

  if (params.membershipId) {
    const member = await prisma.membership.findFirst({
      where: { id: params.membershipId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!member) throw new Error("That person is not on this team.");
  }

  if (params.routeId) {
    const existing = await prisma.salesRoute.findFirst({
      where: { id: params.routeId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!existing) throw new Error("Route not found.");
    return prisma.salesRoute.update({
      where: { id: params.routeId },
      data: {
        name,
        membershipId: params.membershipId ?? null,
        dayOfWeek: day,
        ...(params.isActive === undefined ? {} : { isActive: params.isActive }),
      },
    });
  }

  return prisma.salesRoute.create({
    data: {
      tenantId: params.tenantId,
      name,
      membershipId: params.membershipId ?? null,
      dayOfWeek: day,
    },
  });
}

export async function listRoutes(tenantId: string) {
  return prisma.salesRoute.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ dayOfWeek: "asc" }, { name: "asc" }],
    take: 200,
    include: { _count: { select: { outlets: true } } },
  });
}

export interface CallRow {
  outletId: string;
  partyId: string;
  name: string;
  code: string | null;
  channel: string | null;
  tier: string | null;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  lastVisitAt: Date | null;
  daysSinceVisit: number | null;
  /** Past its cadence, so it is due whether or not today is its route day. */
  overdue: boolean;
}

/**
 * Today's calls.
 *
 * Two things make an outlet due: it sits on a route scheduled for today, or
 * it has gone past its own visit cadence. The second matters more — a route
 * day that gets rained off should not mean a shop waits another week.
 *
 * Ordered overdue first, then by tier, so a day that runs short runs short
 * on the least important shops rather than on the last ones in the list.
 */
export async function todaysCalls(params: {
  tenantId: string;
  membershipId?: string;
  now?: Date;
}): Promise<CallRow[]> {
  const now = params.now ?? new Date();
  // getDay() is 0-based from Sunday; routes are stored 1 = Monday.
  const dayOfWeek = ((now.getDay() + 6) % 7) + 1;

  const routes = await prisma.salesRoute.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      ...(params.membershipId ? { membershipId: params.membershipId } : {}),
    },
    select: { id: true, dayOfWeek: true },
    take: 200,
  });
  const todaysRouteIds = routes.filter((r) => r.dayOfWeek === dayOfWeek).map((r) => r.id);
  const myRouteIds = routes.map((r) => r.id);

  const outlets = await prisma.outlet.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      ...(params.membershipId ? { routeId: { in: myRouteIds } } : {}),
    },
    take: 1000,
    include: { party: { select: { name: true } } },
  });

  const rows = outlets
    .map((o) => {
      const days = o.lastVisitAt
        ? Math.floor((now.getTime() - o.lastVisitAt.getTime()) / 86_400_000)
        : null;
      const overdue =
        o.visitFrequencyDays != null && (days === null || days >= o.visitFrequencyDays);
      return {
        outletId: o.id,
        partyId: o.partyId,
        name: o.party.name,
        code: o.code,
        channel: o.channel,
        tier: o.tier,
        landmark: o.landmark,
        lat: o.lat,
        lng: o.lng,
        lastVisitAt: o.lastVisitAt,
        daysSinceVisit: days,
        overdue,
        onTodaysRoute: o.routeId !== null && todaysRouteIds.includes(o.routeId),
      };
    })
    .filter((r) => r.overdue || r.onTodaysRoute);

  const tierRank = (t: string | null) => (t === "A" ? 0 : t === "B" ? 1 : t === "C" ? 2 : 3);
  rows.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      tierRank(a.tier) - tierRank(b.tier) ||
      (b.daysSinceVisit ?? 9999) - (a.daysSinceVisit ?? 9999)
  );

  // onTodaysRoute did its job in the filter above and is not part of the
  // contract, so it is stripped rather than returned as a half-documented flag.
  return rows.map((row) => {
    const copy = { ...row } as Partial<typeof row>;
    delete copy.onTodaysRoute;
    return copy as CallRow;
  });
}

export interface VisitStart {
  visitId: string;
  outletName: string;
  distanceMetres: number | null;
  verified: boolean;
  /** Said plainly when it could not be checked, rather than implying it was. */
  note: string;
}

/**
 * Arrive at a shop.
 *
 * The distance is computed here and not trusted from the phone, because a
 * client that reports its own compliance is not evidence of anything.
 */
export async function startVisit(params: {
  tenantId: string;
  outletId: string;
  membershipId: string;
  lat?: number | null;
  lng?: number | null;
  at?: Date;
}): Promise<VisitStart> {
  const outlet = await prisma.outlet.findFirst({
    where: { id: params.outletId, tenantId: params.tenantId },
    include: { party: { select: { name: true } } },
  });
  if (!outlet) throw new Error("Outlet not found.");

  const member = await prisma.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!member) throw new Error("That person is not on this team.");

  let distanceMetres: number | null = null;
  let verified = false;
  let note: string;

  if (
    params.lat != null &&
    params.lng != null &&
    outlet.lat != null &&
    outlet.lng != null
  ) {
    distanceMetres = Math.round(
      haversineKm(outlet.lat, outlet.lng, params.lat, params.lng) * 1000
    );
    verified = distanceMetres <= VERIFY_RADIUS_METRES;
    note = verified
      ? `${distanceMetres}m from the recorded pin.`
      : `${distanceMetres}m from the recorded pin — further than expected. The pin may be wrong, or there may be no usable signal inside the shop.`;
  } else if (outlet.lat == null || outlet.lng == null) {
    note = "This outlet has no pin recorded, so the visit could not be checked against one.";
  } else {
    note = "No location came from the phone, so the visit could not be checked.";
  }

  const visit = await prisma.outletVisit.create({
    data: {
      tenantId: params.tenantId,
      outletId: params.outletId,
      membershipId: params.membershipId,
      arrivedAt: params.at ?? new Date(),
      lat: params.lat ?? null,
      lng: params.lng ?? null,
      distanceMetres,
      verified,
    },
  });

  await prisma.outlet.update({
    where: { id: params.outletId },
    data: { lastVisitAt: visit.arrivedAt },
  });

  return { visitId: visit.id, outletName: outlet.party.name, distanceMetres, verified, note };
}

/** Leave, and say what happened. */
export async function endVisit(params: {
  tenantId: string;
  visitId: string;
  outcome: VisitOutcome;
  transactionId?: string | null;
  note?: string | null;
  photoUrl?: string | null;
  at?: Date;
}) {
  const visit = await prisma.outletVisit.findFirst({
    where: { id: params.visitId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!visit) throw new Error("Visit not found.");

  return prisma.outletVisit.update({
    where: { id: params.visitId },
    data: {
      departedAt: params.at ?? new Date(),
      outcome: params.outcome,
      transactionId: params.transactionId ?? null,
      note: params.note?.trim().slice(0, 500) || null,
      photoUrl: params.photoUrl ?? null,
    },
  });
}

export interface CoverageRow {
  membershipId: string;
  name: string;
  visits: number;
  verified: number;
  orders: number;
  /** Visits that produced an order, as a percentage. The number reps are run on. */
  strikeRatePercent: number;
  /** Visits that could not be placed at the shop. Not an accusation. */
  unverified: number;
}

export interface Coverage {
  rows: CoverageRow[];
  outletsActive: number;
  outletsVisited: number;
  coveragePercent: number;
  summary: string;
}

/**
 * Who called on what, and whether it turned into anything.
 *
 * Strike rate rather than visit count, deliberately. A rep measured on
 * visits will produce visits; the number worth managing is how many of them
 * ended in an order.
 */
export async function coverage(
  tenantId: string,
  sinceDays = 30,
  now = new Date()
): Promise<Coverage> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);

  const [visits, outletsActive, memberships] = await Promise.all([
    prisma.outletVisit.findMany({
      where: { tenantId, arrivedAt: { gte: since } },
      select: { membershipId: true, outletId: true, verified: true, outcome: true },
      take: 20000,
    }),
    prisma.outlet.count({ where: { tenantId, isActive: true } }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
      take: 500,
    }),
  ]);

  const nameOf = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  const byRep = new Map<string, { visits: number; verified: number; orders: number }>();
  const outletsSeen = new Set<string>();

  for (const v of visits) {
    outletsSeen.add(v.outletId);
    const row = byRep.get(v.membershipId) ?? { visits: 0, verified: 0, orders: 0 };
    row.visits += 1;
    if (v.verified) row.verified += 1;
    if (v.outcome === VisitOutcome.ORDER) row.orders += 1;
    byRep.set(v.membershipId, row);
  }

  const rows: CoverageRow[] = [...byRep.entries()]
    .map(([membershipId, r]) => ({
      membershipId,
      name: nameOf.get(membershipId) ?? "Someone",
      visits: r.visits,
      verified: r.verified,
      orders: r.orders,
      strikeRatePercent: r.visits === 0 ? 0 : Math.round((r.orders / r.visits) * 100),
      unverified: r.visits - r.verified,
    }))
    .sort((a, b) => b.strikeRatePercent - a.strikeRatePercent);

  const coveragePercent =
    outletsActive === 0 ? 0 : Math.round((outletsSeen.size / outletsActive) * 100);

  return {
    rows,
    outletsActive,
    outletsVisited: outletsSeen.size,
    coveragePercent,
    summary:
      outletsActive === 0
        ? "No outlets on the map yet."
        : `${outletsSeen.size} of ${outletsActive} outlets called on in ${sinceDays} days.`,
  };
}

export interface QuietOutlet {
  outletId: string;
  partyId: string;
  name: string;
  channel: string | null;
  tier: string | null;
  daysSinceVisit: number | null;
  daysSinceOrder: number | null;
}

/**
 * Shops that have stopped buying.
 *
 * Distinct from a rep not visiting: an outlet visited weekly that has not
 * ordered in two months is a listing that has been lost to a competitor, and
 * that is a different conversation from an outlet nobody has been to.
 */
export async function outletsGoneQuiet(
  tenantId: string,
  afterDays = 45,
  now = new Date()
): Promise<QuietOutlet[]> {
  const cutoff = new Date(now.getTime() - afterDays * 86_400_000);

  const outlets = await prisma.outlet.findMany({
    where: { tenantId, isActive: true },
    take: 1000,
    include: { party: { select: { id: true, name: true } } },
  });
  if (outlets.length === 0) return [];

  const lastOrders = await prisma.transaction.groupBy({
    by: ["partyId"],
    where: {
      tenantId,
      partyId: { in: outlets.map((o) => o.partyId) },
      type: "INVOICE",
      status: { notIn: ["CANCELLED", "DRAFT"] },
    },
    _max: { createdAt: true },
  });
  const lastOrderOf = new Map(lastOrders.map((o) => [o.partyId, o._max.createdAt]));

  return outlets
    .map((o) => {
      const lastOrder = lastOrderOf.get(o.partyId) ?? null;
      return {
        outletId: o.id,
        partyId: o.partyId,
        name: o.party.name,
        channel: o.channel,
        tier: o.tier,
        daysSinceVisit: o.lastVisitAt
          ? Math.floor((now.getTime() - o.lastVisitAt.getTime()) / 86_400_000)
          : null,
        daysSinceOrder: lastOrder
          ? Math.floor((now.getTime() - lastOrder.getTime()) / 86_400_000)
          : null,
        lastOrder,
      };
    })
    .filter((o) => o.lastOrder === null || o.lastOrder < cutoff)
    .sort((a, b) => (b.daysSinceOrder ?? 99999) - (a.daysSinceOrder ?? 99999))
    .slice(0, 200)
    .map((row) => {
      const copy = { ...row } as Partial<typeof row>;
      delete copy.lastOrder;
      return copy as QuietOutlet;
    });
}

/** One shop's history of being called on. */
export async function outletVisits(tenantId: string, outletId: string, limit = 50) {
  return prisma.outletVisit.findMany({
    where: { tenantId, outletId },
    orderBy: { arrivedAt: "desc" },
    take: Math.min(limit, 200),
  });
}
