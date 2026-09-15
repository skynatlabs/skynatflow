// What things actually cost, and what work actually earned.
//
// Three figures no competitor can produce because none of them holds both
// halves of the business:
//
//   cost per unit of capacity — every rand on a vehicle (fuel, tyres, the
//     licence disc, the insurance, its share of its own purchase price, the
//     driver's hours) divided by the kilometres it did. Per hour for a
//     machine, per day for a crew.
//   margin per job — what an invoice earned after the goods on it, the costs
//     tagged to it, and the share of the trip that delivered it.
//   margin per lane — the same, for a route, across every run down it.
//
// Every figure carries its denominator's provenance. A cost per kilometre
// from an odometer pair and one from two trips with typed distances are not
// the same kind of number, and a report that showed them the same way would
// be lying by layout.

import { CapacityUnit, ObligationRecurrence, TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPENT } from "./expenses";
import { computeDocumentTotal } from "./pricing";
import { tripHours } from "./trips";

export interface Period {
  from: Date;
  to: Date;
}

export function lastDays(days: number, now = new Date()): Period {
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

export function periodDays(p: Period): number {
  return Math.max(1, (p.to.getTime() - p.from.getTime()) / 86_400_000);
}

/** How many times a year an obligation on this recurrence falls due. */
const PER_YEAR: Record<ObligationRecurrence, number> = {
  NONE: 1,
  MONTHLY: 12,
  BIMONTHLY: 6,
  QUARTERLY: 4,
  BIANNUAL: 2,
  ANNUAL: 1,
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface AssetCost {
  assetId: string;
  name: string;
  registration: string | null;
  capacityUnit: CapacityUnit | null;
  directCents: number;
  obligationCents: number;
  depreciationCents: number;
  labourCents: number;
  totalCents: number;
  /** Kilometres, hours or days, per capacityUnit. */
  units: number;
  unitsSource: "ODOMETER" | "TRIPS" | "NONE";
  tripCount: number;
  /** Cents per unit, or null when there is nothing to divide by or nothing to divide. */
  costPerUnitCents: number | null;
  confidence: Confidence;
}

/**
 * Every asset's cost over the period, and what that is per unit of capacity.
 *
 * Direct costs are what was tagged to it. Obligations with a price on them
 * (insurance, the licence) are annualised and apportioned by days. Its own
 * purchase price is spread over its stated life. Labour is the driver's cost
 * rate over the hours of its trips. Units come from odometer readings when
 * there are enough of them — a fuel slip is where those get captured without
 * anybody being asked — and from trip distances otherwise.
 */
export async function assetCosts(tenantId: string, period: Period): Promise<AssetCost[]> {
  const days = periodDays(period);
  const months = days / 30.4375;

  const [assets, expenses, obligations, trips] = await Promise.all([
    prisma.asset.findMany({
      where: { tenantId, status: { notIn: ["LOST", "RETIRED"] } },
      select: {
        id: true, name: true, registration: true, capacityUnit: true,
        purchasedOn: true, purchaseCents: true, usefulLifeMonths: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        tenantId, status: SPENT, assetId: { not: null },
        spentOn: { gte: period.from, lte: period.to }, isOwnerDrawing: { not: true },
      },
      select: { assetId: true, amountCents: true, odometerKm: true },
    }),
    prisma.obligation.findMany({
      where: { tenantId, assetId: { not: null }, amountCents: { not: null }, status: "OPEN" },
      select: { assetId: true, amountCents: true, recurrence: true },
    }),
    prisma.trip.findMany({
      where: { tenantId, status: "DONE", assetId: { not: null }, startedAt: { gte: period.from, lte: period.to } },
      select: {
        assetId: true, distanceKm: true, startedAt: true, endedAt: true,
        odometerStartKm: true, odometerEndKm: true,
        driver: { select: { costRateCents: true } },
      },
    }),
  ]);

  const byAsset = <T extends { assetId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.assetId) m.set(r.assetId, [...(m.get(r.assetId) ?? []), r]);
    return m;
  };
  const expensesByAsset = byAsset(expenses);
  const tripsByAsset = byAsset(trips);
  const obligationsByAsset = byAsset(obligations);

  const out: AssetCost[] = [];
  for (const a of assets) {
    const mine = expensesByAsset.get(a.id) ?? [];
    const myTrips = tripsByAsset.get(a.id) ?? [];
    const myObligations = obligationsByAsset.get(a.id) ?? [];

    const directCents = mine.reduce((s, e) => s + e.amountCents, 0);
    const obligationCents = Math.round(
      myObligations.reduce((s, o) => s + (o.amountCents ?? 0) * PER_YEAR[o.recurrence] * (days / 365), 0)
    );

    let depreciationCents = 0;
    if (a.purchaseCents && a.usefulLifeMonths && a.usefulLifeMonths > 0) {
      const inService = !a.purchasedOn || a.purchasedOn <= period.to;
      const notYetWrittenOff =
        !a.purchasedOn ||
        new Date(a.purchasedOn.getTime() + a.usefulLifeMonths * 30.4375 * 86_400_000) > period.from;
      if (inService && notYetWrittenOff) {
        depreciationCents = Math.round((a.purchaseCents / a.usefulLifeMonths) * months);
      }
    }

    let labourCents = 0;
    let hours = 0;
    const dayKeys = new Set<string>();
    for (const t of myTrips) {
      const h = tripHours(t) ?? 0;
      hours += h;
      if (t.driver?.costRateCents) labourCents += Math.round(h * t.driver.costRateCents);
      if (t.startedAt) dayKeys.add(t.startedAt.toISOString().slice(0, 10));
    }

    // Kilometres: the odometer knows more than the trip log does, because it
    // moves whether or not anybody logged the run.
    const readings = [
      ...mine.map((e) => e.odometerKm).filter((k): k is number => k !== null && k > 0),
      ...myTrips.flatMap((t) => [t.odometerStartKm, t.odometerEndKm]).filter((k): k is number => k !== null && k > 0),
    ];
    const odometerKm = readings.length >= 2 ? Math.max(...readings) - Math.min(...readings) : 0;
    const tripKm = myTrips.reduce((s, t) => s + (t.distanceKm ?? 0), 0);

    let units = 0;
    let unitsSource: AssetCost["unitsSource"] = "NONE";
    if (a.capacityUnit === "KM") {
      if (odometerKm >= tripKm && odometerKm > 0) {
        units = odometerKm;
        unitsSource = "ODOMETER";
      } else if (tripKm > 0) {
        units = tripKm;
        unitsSource = "TRIPS";
      }
    } else if (a.capacityUnit === "HOUR") {
      units = Math.round(hours * 10) / 10;
      unitsSource = units > 0 ? "TRIPS" : "NONE";
    } else if (a.capacityUnit === "DAY") {
      units = dayKeys.size;
      unitsSource = units > 0 ? "TRIPS" : "NONE";
    }

    const totalCents = directCents + obligationCents + depreciationCents + labourCents;
    const costPerUnitCents = units > 0 && totalCents > 0 ? Math.round(totalCents / units) : null;

    const evidencePoints = (unitsSource === "ODOMETER" ? readings.length : 0) + myTrips.filter((t) => t.distanceKm).length;
    const confidence: Confidence =
      costPerUnitCents === null ? "LOW"
        : unitsSource === "ODOMETER" && readings.length >= 3 && mine.length >= 3 ? "HIGH"
        : evidencePoints >= 3 ? "MEDIUM"
        : "LOW";

    out.push({
      assetId: a.id,
      name: a.name,
      registration: a.registration,
      capacityUnit: a.capacityUnit,
      directCents,
      obligationCents,
      depreciationCents,
      labourCents,
      totalCents,
      units,
      unitsSource,
      tripCount: myTrips.length,
      costPerUnitCents,
      confidence,
    });
  }

  return out.sort((a, b) => b.totalCents - a.totalCents);
}

// ------------------------------------------------------------- trip costs

export interface CostRates {
  perKmByAsset: Map<string, number>;
  /** Across every vehicle with a figure. Null when none has one. */
  fleetPerKmCents: number | null;
}

/**
 * Per-kilometre rates for the period. Pass asset costs already computed for
 * the same period and they are used rather than worked out again — a page
 * showing costs and margins together otherwise prices the fleet three times.
 */
export async function costRates(
  tenantId: string,
  period: Period,
  assets?: AssetCost[] | Promise<AssetCost[]>
): Promise<CostRates> {
  return ratesFrom(await (assets ?? assetCosts(tenantId, period)));
}

export function ratesFrom(assets: AssetCost[]): CostRates {
  const perKmByAsset = new Map<string, number>();
  let km = 0;
  let cents = 0;
  for (const a of assets) {
    if (a.capacityUnit !== "KM" || a.costPerUnitCents === null) continue;
    perKmByAsset.set(a.assetId, a.costPerUnitCents);
    km += a.units;
    cents += a.totalCents;
  }
  return { perKmByAsset, fleetPerKmCents: km > 0 ? Math.round(cents / km) : null };
}

/**
 * What one trip cost, from its vehicle's fully loaded per-kilometre rate.
 *
 * The rate already holds fuel, upkeep, cover, depreciation and the driver's
 * hours, so nothing tagged to the trip is added on top — it is in the rate.
 * A trip with no distance cannot be priced, and says so rather than costing
 * nothing.
 */
export function tripCostCents(
  trip: { assetId: string | null; distanceKm: number | null },
  rates: CostRates
): { cents: number; priced: boolean } {
  if (!trip.distanceKm || trip.distanceKm <= 0) return { cents: 0, priced: false };
  const rate = (trip.assetId ? rates.perKmByAsset.get(trip.assetId) : undefined) ?? rates.fleetPerKmCents;
  if (!rate) return { cents: 0, priced: false };
  return { cents: Math.round(trip.distanceKm * rate), priced: true };
}

// ----------------------------------------------------------- job margins

export interface JobMargin {
  transactionId: string;
  partyId: string;
  partyName: string;
  date: Date;
  /** What the customer pays, without the tax that goes straight through. */
  revenueCents: number;
  /** Goods on the document at their catalogue cost. */
  cogsCents: number;
  /** Costs somebody tagged to this document. */
  directCents: number;
  /** This document's share of the trips that served it. */
  travelCents: number;
  travelPriced: boolean;
  marginCents: number;
  marginPercent: number | null;
}

/** Documents that never became money: drafts, cancellations, declines. */
const NOT_BILLED: TransactionStatus[] = ["DRAFT", "CANCELLED", "DECLINED"];
const BILLED = { notIn: NOT_BILLED };

function netRevenue(t: {
  amountCents: number;
  discountPercent: number | null;
  itemLines: Array<{ quantity: number; unitPriceCents: number; discountPercent: number | null; taxRatePercent: number | null }>;
}): number {
  if (t.itemLines.length === 0) return t.amountCents;
  const totals = computeDocumentTotal(
    t.itemLines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent ?? 0,
      taxRatePercent: l.taxRatePercent ?? undefined,
    })),
    t.discountPercent ?? 0
  );
  return Math.max(0, t.amountCents - totals.taxCents);
}

export interface MarginOptions {
  /** One customer's jobs only — a customer's own page needs nobody else's. */
  partyId?: string;
  /** Rates already worked out for the same period. */
  rates?: CostRates | Promise<CostRates>;
}

export async function jobMargins(tenantId: string, period: Period, opts: MarginOptions = {}): Promise<JobMargin[]> {
  const billed = {
    tenantId, type: "INVOICE" as const, status: BILLED, createdAt: { gte: period.from, lte: period.to },
    ...(opts.partyId ? { partyId: opts.partyId } : {}),
  };
  // Nothing below waits on anything else: the costs tagged to the invoices
  // and the trips that served them are found through the invoices' own
  // filter rather than a list of their ids read first.
  const [invoices, direct, stops, rates] = await Promise.all([
    prisma.transaction.findMany({
      where: billed,
      select: {
        id: true, partyId: true, amountCents: true, discountPercent: true, createdAt: true,
        party: { select: { name: true } },
        itemLines: {
          select: {
            quantity: true, unitPriceCents: true, discountPercent: true, taxRatePercent: true,
            item: { select: { costCents: true } },
          },
        },
      },
    }),
    prisma.expense.groupBy({
      by: ["transactionId"],
      where: { tenantId, status: SPENT, transactionId: { not: null }, isOwnerDrawing: { not: true }, transaction: billed },
      _sum: { amountCents: true },
    }),
    prisma.tripStop.findMany({
      where: { tenantId, transactionId: { not: null }, transaction: billed, trip: { status: "DONE" } },
      select: {
        transactionId: true,
        trip: { select: { id: true, assetId: true, distanceKm: true, _count: { select: { stops: true } } } },
      },
    }),
    opts.rates ?? costRates(tenantId, period),
  ]);
  if (invoices.length === 0) return [];

  const directById = new Map(direct.map((d) => [d.transactionId!, d._sum.amountCents ?? 0]));
  const travelById = new Map<string, { cents: number; priced: boolean; any: boolean }>();
  for (const s of stops) {
    const cost = tripCostCents(s.trip, rates);
    const share = Math.round(cost.cents / Math.max(1, s.trip._count.stops));
    const cur = travelById.get(s.transactionId!) ?? { cents: 0, priced: true, any: false };
    cur.cents += share;
    cur.priced = cur.priced && cost.priced;
    cur.any = true;
    travelById.set(s.transactionId!, cur);
  }

  return invoices
    .map((inv) => {
      const revenueCents = netRevenue(inv);
      const cogsCents = inv.itemLines.reduce((s, l) => s + l.quantity * (l.item.costCents ?? 0), 0);
      const directCents = directById.get(inv.id) ?? 0;
      const travel = travelById.get(inv.id);
      const travelCents = travel?.cents ?? 0;
      const marginCents = revenueCents - cogsCents - directCents - travelCents;
      return {
        transactionId: inv.id,
        partyId: inv.partyId,
        partyName: inv.party.name,
        date: inv.createdAt,
        revenueCents,
        cogsCents,
        directCents,
        travelCents,
        // No trip at all is "priced" in the sense that nothing is missing;
        // a trip with no rate is the honest gap.
        travelPriced: travel ? travel.priced : true,
        marginCents,
        marginPercent: revenueCents > 0 ? Math.round((marginCents / revenueCents) * 100) : null,
      };
    })
    .sort((a, b) => a.marginCents - b.marginCents);
}

export interface CustomerMargin {
  partyId: string;
  partyName: string;
  jobs: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPercent: number | null;
  travelPriced: boolean;
}

export async function customerMargins(tenantId: string, period: Period, opts: MarginOptions = {}): Promise<CustomerMargin[]> {
  const jobs = await jobMargins(tenantId, period, opts);
  const by = new Map<string, CustomerMargin>();
  for (const j of jobs) {
    const cur = by.get(j.partyId) ?? {
      partyId: j.partyId, partyName: j.partyName, jobs: 0, revenueCents: 0, costCents: 0,
      marginCents: 0, marginPercent: null, travelPriced: true,
    };
    cur.jobs += 1;
    cur.revenueCents += j.revenueCents;
    cur.costCents += j.cogsCents + j.directCents + j.travelCents;
    cur.marginCents += j.marginCents;
    cur.travelPriced = cur.travelPriced && j.travelPriced;
    by.set(j.partyId, cur);
  }
  return [...by.values()]
    .map((c) => ({ ...c, marginPercent: c.revenueCents > 0 ? Math.round((c.marginCents / c.revenueCents) * 100) : null }))
    .sort((a, b) => a.marginCents - b.marginCents);
}

export interface LaneMargin {
  laneKey: string;
  trips: number;
  /** Stops on the lane, and how many of them carried an invoice. Revenue is only as complete as this. */
  stops: number;
  linkedStops: number;
  km: number;
  costCents: number;
  revenueCents: number;
  marginCents: number;
  /** What each kilometre down this lane earned after costs. */
  marginPerKmCents: number | null;
  priced: boolean;
}

/**
 * Margin per lane. Revenue is what the invoices delivered on the lane's trips
 * came to — split across a document's stops when one document was served by
 * several — and cost is every run's fully loaded distance cost.
 */
export async function laneMargins(tenantId: string, period: Period, opts: Pick<MarginOptions, "rates"> = {}): Promise<LaneMargin[]> {
  const onLane = { tenantId, status: "DONE" as const, laneKey: { not: null }, startedAt: { gte: period.from, lte: period.to } };
  // Trips, their stops and the documents on them are read side by side and
  // joined here, rather than as a chain where each waits for the last.
  const [tripRows, stopRows, docs, rates] = await Promise.all([
    prisma.trip.findMany({ where: onLane, select: { id: true, laneKey: true, assetId: true, distanceKm: true } }),
    prisma.tripStop.findMany({ where: { tenantId, trip: onLane }, select: { tripId: true, transactionId: true } }),
    prisma.transaction.findMany({
      where: { tenantId, tripStops: { some: { trip: onLane } } },
      select: {
        id: true, amountCents: true, discountPercent: true, type: true, status: true,
        itemLines: { select: { quantity: true, unitPriceCents: true, discountPercent: true, taxRatePercent: true } },
      },
    }),
    opts.rates ?? costRates(tenantId, period),
  ]);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const stopsByTrip = new Map<string, Array<{ transactionId: string | null; transaction: (typeof docs)[number] | null }>>();
  for (const s of stopRows) {
    const list = stopsByTrip.get(s.tripId) ?? [];
    list.push({ transactionId: s.transactionId, transaction: s.transactionId ? docById.get(s.transactionId) ?? null : null });
    stopsByTrip.set(s.tripId, list);
  }
  const trips = tripRows.map((t) => ({ ...t, stops: stopsByTrip.get(t.id) ?? [] }));

  // A document served by three stops counts a third at each.
  const stopsPerDoc = new Map<string, number>();
  for (const t of trips) for (const s of t.stops) if (s.transactionId) stopsPerDoc.set(s.transactionId, (stopsPerDoc.get(s.transactionId) ?? 0) + 1);

  const lanes = new Map<string, LaneMargin>();
  for (const t of trips) {
    const cur = lanes.get(t.laneKey!) ?? {
      laneKey: t.laneKey!, trips: 0, stops: 0, linkedStops: 0, km: 0, costCents: 0, revenueCents: 0, marginCents: 0, marginPerKmCents: null, priced: true,
    };
    const cost = tripCostCents(t, rates);
    cur.trips += 1;
    cur.km += t.distanceKm ?? 0;
    cur.costCents += cost.cents;
    cur.priced = cur.priced && cost.priced;
    for (const s of t.stops) {
      cur.stops += 1;
      const doc = s.transaction;
      if (!doc || doc.type !== "INVOICE" || NOT_BILLED.includes(doc.status)) continue;
      cur.linkedStops += 1;
      cur.revenueCents += Math.round(netRevenue(doc) / (stopsPerDoc.get(doc.id) ?? 1));
    }
    lanes.set(t.laneKey!, cur);
  }

  return [...lanes.values()]
    .map((l) => ({
      ...l,
      km: Math.round(l.km),
      marginCents: l.revenueCents - l.costCents,
      marginPerKmCents: l.km > 0 ? Math.round((l.revenueCents - l.costCents) / l.km) : null,
    }))
    .sort((a, b) => a.marginCents - b.marginCents);
}

// ------------------------------------------------------------ fleet cost

export interface FleetCost {
  vehicles: number;
  totalCents: number;
  km: number;
  perKmCents: number | null;
  revenueCents: number;
  percentOfRevenue: number | null;
  byAsset: AssetCost[];
}

/**
 * What it costs this business to move — whether or not it thinks of itself
 * as one that moves. An electrician driving to four jobs a day has a fleet
 * cost; this is where they find out what it is.
 */
export async function fleetCost(
  tenantId: string,
  period: Period,
  precomputed?: AssetCost[] | Promise<AssetCost[]>
): Promise<FleetCost> {
  const [assets, revenue] = await Promise.all([
    precomputed ?? assetCosts(tenantId, period),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: BILLED, createdAt: { gte: period.from, lte: period.to } },
      select: {
        amountCents: true, discountPercent: true,
        itemLines: { select: { quantity: true, unitPriceCents: true, discountPercent: true, taxRatePercent: true } },
      },
    }),
  ]);
  const vehicles = assets.filter((a) => a.capacityUnit === "KM");
  const totalCents = vehicles.reduce((s, a) => s + a.totalCents, 0);
  const km = vehicles.reduce((s, a) => s + a.units, 0);
  const revenueCents = revenue.reduce((s, t) => s + netRevenue(t), 0);
  return {
    vehicles: vehicles.length,
    totalCents,
    km: Math.round(km),
    perKmCents: km > 0 && totalCents > 0 ? Math.round(totalCents / km) : null,
    revenueCents,
    percentOfRevenue: revenueCents > 0 ? Math.round((totalCents / revenueCents) * 100) : null,
    byAsset: vehicles,
  };
}

// ---------------------------------------------------------------- inputs

/** What an hour of a person costs the business. Owner-level; it is not their pay, it is their cost. */
export async function setCostRate(tenantId: string, membershipId: string, costRateCents: number | null) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
  if (!m) throw new Error("Team member not found.");
  if (costRateCents !== null && (!Number.isFinite(costRateCents) || costRateCents < 0)) {
    throw new Error("A cost rate cannot be negative.");
  }
  return prisma.membership.update({ where: { id: membershipId }, data: { costRateCents } });
}

/** What one unit of an asset's capacity is, and what it is known by. */
export async function setAssetCapacity(
  tenantId: string,
  assetId: string,
  params: { capacityUnit: CapacityUnit | null; registration?: string | null }
) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, registration: true } });
  if (!a) throw new Error("Asset not found.");
  return prisma.asset.update({
    where: { id: assetId },
    data: {
      capacityUnit: params.capacityUnit,
      registration: params.registration === undefined ? a.registration : params.registration?.trim() || null,
    },
  });
}
