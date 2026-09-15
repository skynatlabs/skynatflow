// The gap between a day as planned and a day as lived.
//
// Two things nobody can see from inside the day: that the four stops could
// have been driven in an order twenty kilometres shorter, and that the job
// quoted at two hours has taken three for the last five visits. Both are
// arithmetic over stops that already have times and positions on them; the
// only reason they go unnoticed is that no individual dispatcher is holding
// the whole week in their head.

import { prisma } from "@/lib/db";
import { haversineKm } from "./trips";

export interface RouteWaste {
  tripId: string;
  date: Date;
  driverName: string | null;
  stops: number;
  /** Kilometres in the order actually driven, stop to stop. */
  drivenKm: number;
  /** Kilometres in the best order found. */
  bestKm: number;
  wastedKm: number;
  wastedPercent: number;
  bestOrder: string[];
}

/**
 * Nearest-neighbour from the origin, then improved with 2-opt.
 *
 * Not optimal in general and not meant to be: the claim being made is "this
 * would have been shorter", which holds whenever the found route is shorter,
 * whatever the true optimum is. The point is a number a driver can check on
 * a map, not a proof.
 */
export function bestOrder<T extends { lat: number; lng: number }>(
  origin: { lat: number; lng: number },
  stops: T[]
): { order: T[]; km: number } {
  if (stops.length === 0) return { order: [], km: 0 };
  const remaining = [...stops];
  const order: T[] = [];
  let cur = origin;
  while (remaining.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineKm(cur.lat, cur.lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    const [next] = remaining.splice(bestI, 1);
    order.push(next);
    cur = next;
  }

  const length = (o: T[]) => {
    let km = 0;
    let p = origin;
    for (const s of o) {
      km += haversineKm(p.lat, p.lng, s.lat, s.lng);
      p = s;
    }
    return km;
  };

  // 2-opt: keep reversing segments while it shortens the route.
  let improved = true;
  let best = length(order);
  while (improved && order.length > 2) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const km = length(candidate);
        if (km + 0.01 < best) {
          order.splice(0, order.length, ...candidate);
          best = km;
          improved = true;
        }
      }
    }
  }
  return { order, km: Math.round(best * 10) / 10 };
}

/**
 * Trips whose stops, driven in a different order, would have been shorter
 * by enough to matter. Needs three or more positioned stops; with two there
 * is nothing to reorder.
 */
export async function routeWaste(
  tenantId: string,
  opts: { from?: Date; to?: Date; minPercent?: number } = {}
): Promise<RouteWaste[]> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const minPercent = opts.minPercent ?? 15;

  const trips = await prisma.trip.findMany({
    where: { tenantId, status: "DONE", startedAt: { gte: from, lte: to } },
    include: {
      stops: { orderBy: { sequence: "asc" }, include: { party: { select: { name: true } } } },
      driver: { select: { user: { select: { name: true, email: true } } } },
    },
  });

  const out: RouteWaste[] = [];
  for (const trip of trips) {
    const positioned = trip.stops.filter(
      (s): s is typeof s & { lat: number; lng: number } => s.lat !== null && s.lng !== null
    );
    if (positioned.length < 3) continue;

    // The origin is where the trip began; when that was not recorded, the
    // first stop stands in for it and only the rest are reordered.
    const origin =
      trip.originLat !== null && trip.originLng !== null
        ? { lat: trip.originLat, lng: trip.originLng }
        : { lat: positioned[0].lat, lng: positioned[0].lng };
    const toOrder = trip.originLat !== null && trip.originLng !== null ? positioned : positioned.slice(1);
    if (toOrder.length < 2) continue;

    // Driven order: in the sequence the driver actually visited them (by
    // arrival time where known, else by planned sequence).
    const driven = [...toOrder].sort((a, b) => {
      if (a.arrivedAt && b.arrivedAt) return a.arrivedAt.getTime() - b.arrivedAt.getTime();
      return a.sequence - b.sequence;
    });
    let drivenKm = 0;
    let p = origin;
    for (const s of driven) {
      drivenKm += haversineKm(p.lat, p.lng, s.lat, s.lng);
      p = s;
    }
    drivenKm = Math.round(drivenKm * 10) / 10;

    const best = bestOrder(origin, toOrder);
    const wastedKm = Math.round((drivenKm - best.km) * 10) / 10;
    const wastedPercent = drivenKm > 0 ? Math.round((wastedKm / drivenKm) * 100) : 0;
    if (wastedKm < 2 || wastedPercent < minPercent) continue;

    out.push({
      tripId: trip.id,
      date: trip.startedAt ?? trip.createdAt,
      driverName: trip.driver?.user.name ?? trip.driver?.user.email ?? null,
      stops: positioned.length,
      drivenKm,
      bestKm: best.km,
      wastedKm,
      wastedPercent,
      bestOrder: best.order.map((s) => s.party?.name ?? s.label ?? s.addressText ?? `Stop ${s.sequence + 1}`),
    });
  }
  return out.sort((a, b) => b.wastedKm - a.wastedKm);
}

export interface SiteTimeOverrun {
  partyId: string;
  partyName: string;
  visits: number;
  quotedHours: number;
  actualHours: number;
  overrunHours: number;
  overrunPercent: number;
}

const HOUR_UNITS = /^(h|hr|hrs|hour|hours|uur|ure)$/i;

/**
 * Customers whose jobs consistently take longer on site than was quoted.
 *
 * Quoted time is read off the document's own lines — anything sold by the
 * hour — and actual time off the stop's arrival and departure. One long visit
 * is a bad day; a pattern across visits is a price that is wrong.
 */
export async function siteTimeOverruns(
  tenantId: string,
  opts: { from?: Date; to?: Date; minVisits?: number; minPercent?: number } = {}
): Promise<SiteTimeOverrun[]> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 90 * 86_400_000);
  const minVisits = opts.minVisits ?? 2;
  const minPercent = opts.minPercent ?? 25;

  const stops = await prisma.tripStop.findMany({
    where: {
      tenantId,
      arrivedAt: { not: null, gte: from, lte: to },
      departedAt: { not: null },
      transactionId: { not: null },
    },
    include: {
      transaction: {
        select: {
          partyId: true,
          party: { select: { name: true } },
          itemLines: { select: { quantity: true, item: { select: { unit: true } } } },
        },
      },
    },
  });

  const byParty = new Map<string, { name: string; visits: number; quoted: number; actual: number }>();
  for (const s of stops) {
    if (!s.transaction || !s.arrivedAt || !s.departedAt) continue;
    const quoted = s.transaction.itemLines
      .filter((l) => l.item.unit && HOUR_UNITS.test(l.item.unit))
      .reduce((sum, l) => sum + l.quantity, 0);
    if (quoted <= 0) continue;
    const actual = (s.departedAt.getTime() - s.arrivedAt.getTime()) / 3_600_000;
    const cur = byParty.get(s.transaction.partyId) ?? {
      name: s.transaction.party.name,
      visits: 0,
      quoted: 0,
      actual: 0,
    };
    cur.visits += 1;
    cur.quoted += quoted;
    cur.actual += actual;
    byParty.set(s.transaction.partyId, cur);
  }

  const out: SiteTimeOverrun[] = [];
  for (const [partyId, v] of byParty) {
    if (v.visits < minVisits) continue;
    const overrun = v.actual - v.quoted;
    const pct = v.quoted > 0 ? Math.round((overrun / v.quoted) * 100) : 0;
    if (pct < minPercent) continue;
    out.push({
      partyId,
      partyName: v.name,
      visits: v.visits,
      quotedHours: Math.round(v.quoted * 10) / 10,
      actualHours: Math.round(v.actual * 10) / 10,
      overrunHours: Math.round(overrun * 10) / 10,
      overrunPercent: pct,
    });
  }
  return out.sort((a, b) => b.overrunHours - a.overrunHours);
}

export interface TravelSummary {
  from: Date;
  to: Date;
  trips: number;
  drivingHours: number;
  onSiteHours: number;
  /** Time on the clock between the first departure and the last arrival that was neither. */
  betweenHours: number;
  routeWaste: RouteWaste[];
  overruns: SiteTimeOverrun[];
}

export async function travelSummary(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<TravelSummary> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 30 * 86_400_000);

  const trips = await prisma.trip.findMany({
    where: { tenantId, status: "DONE", startedAt: { gte: from, lte: to }, endedAt: { not: null } },
    select: { startedAt: true, endedAt: true, stops: { select: { arrivedAt: true, departedAt: true } } },
  });

  let total = 0;
  let onSite = 0;
  for (const t of trips) {
    total += (t.endedAt!.getTime() - t.startedAt!.getTime()) / 3_600_000;
    for (const s of t.stops) {
      if (s.arrivedAt && s.departedAt) onSite += (s.departedAt.getTime() - s.arrivedAt.getTime()) / 3_600_000;
    }
  }

  const [waste, overruns] = await Promise.all([
    routeWaste(tenantId, { from, to }),
    siteTimeOverruns(tenantId, { from, to }),
  ]);

  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    from,
    to,
    trips: trips.length,
    drivingHours: r(Math.max(0, total - onSite)),
    onSiteHours: r(onSite),
    betweenHours: 0,
    routeWaste: waste,
    overruns,
  };
}
