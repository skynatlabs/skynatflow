// Fleet operations — the logistics arc (143–152).
//
// Ten things a transport operator loses money on without seeing, each
// computed from what the trip, stop, expense and asset records already hold:
//
//   143 detention — time given away at a customer's gate
//   144 recoverable costs — tolls and permits that never reach an invoice
//   145 empty running — vehicles ending far from base with nothing to bring back
//   146 fuel consumption — litres per 100 km, flagged as a pattern, never one tank
//   147 maintenance off the odometer — services due by distance, not calendar
//   148 consumables — tyres and blades as a cost per kilometre
//   149 load planning — gross weight against what the vehicle may carry
//   150 subcontractor gate — owner-drivers refused like employees when cover lapses
//   151 incidents — the insurer's pack assembled at the scene
//   152 plan versus actual — a route deviation unusual for that lane
//
// Deterministic throughout; the COO carries the findings to the bus.

import { TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPENT } from "./expenses";
import { blockingObligationsFor, daysBetween, WorkBlockedError, type BlockingObligation } from "./obligations";
import { haversineKm } from "./trips";

const DAY = 86_400_000;

// ------------------------------------------------------------------ 143

export interface DetentionLine {
  stopId: string;
  tripId: string;
  partyId: string | null;
  partyName: string;
  transactionId: string | null;
  arrivedAt: Date;
  departedAt: Date;
  onSiteMinutes: number;
  billableMinutes: number;
  cents: number | null;
  billed: boolean;
}

/**
 * Stops where the vehicle stood longer than the free allowance. The times
 * are what defend the charge, so they travel with every line.
 */
export async function detentionOwed(tenantId: string, opts: { since?: Date } = {}): Promise<DetentionLine[]> {
  const since = opts.since ?? new Date(Date.now() - 60 * DAY);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { detentionFreeMinutes: true, detentionRateCents: true },
  });
  const free = tenant?.detentionFreeMinutes ?? 60;
  const rate = tenant?.detentionRateCents ?? null;

  const stops = await prisma.tripStop.findMany({
    where: { tenantId, arrivedAt: { not: null, gte: since }, departedAt: { not: null } },
    select: {
      id: true, tripId: true, partyId: true, transactionId: true, arrivedAt: true, departedAt: true, detentionBilledOnId: true,
      party: { select: { name: true } },
    },
    orderBy: { arrivedAt: "desc" },
    // A fleet running fifty stops a day fills a quarter with four and a half
    // thousand rows. The report is about the worst offenders and it is
    // already ordered by most recent, so a cap changes what is read and not
    // what is concluded.
    take: 2000,
  });

  const out: DetentionLine[] = [];
  for (const s of stops) {
    const minutes = Math.round((s.departedAt!.getTime() - s.arrivedAt!.getTime()) / 60_000);
    const billable = minutes - free;
    if (billable <= 0) continue;
    out.push({
      stopId: s.id,
      tripId: s.tripId,
      partyId: s.partyId,
      partyName: s.party?.name ?? "A stop",
      transactionId: s.transactionId,
      arrivedAt: s.arrivedAt!,
      departedAt: s.departedAt!,
      onSiteMinutes: minutes,
      billableMinutes: billable,
      // Billed per started half hour — the convention most rate cards use.
      cents: rate ? Math.ceil(billable / 30) * Math.round(rate / 2) : null,
      billed: Boolean(s.detentionBilledOnId),
    });
  }
  return out;
}

async function detentionItem(tenantId: string) {
  const existing = await prisma.item.findFirst({ where: { tenantId, name: "Detention / standing time" } });
  if (existing) return existing;
  return prisma.item.create({ data: { tenantId, name: "Detention / standing time", unit: "half hour", unitPriceCents: 0, isActive: true } });
}

async function recoverablesItem(tenantId: string) {
  const existing = await prisma.item.findFirst({ where: { tenantId, name: "Recoverable costs" } });
  if (existing) return existing;
  return prisma.item.create({ data: { tenantId, name: "Recoverable costs", unit: "each", unitPriceCents: 0, isActive: true } });
}

/**
 * Put a stop's detention onto a DRAFT invoice for that customer — a draft,
 * because the customer is charged only once a person has looked at it.
 */
export async function billDetention(tenantId: string, stopId: string) {
  const [line] = (await detentionOwed(tenantId, { since: new Date(0) })).filter((l) => l.stopId === stopId);
  if (!line) throw new Error("No billable detention at that stop.");
  if (line.billed) throw new Error("Already billed.");
  if (!line.partyId) throw new Error("The stop has no customer to bill.");
  if (!line.cents) throw new Error("Set a detention rate first.");

  const item = await detentionItem(tenantId);
  const halfHours = Math.ceil(line.billableMinutes / 30);
  const unit = Math.round(line.cents / halfHours);
  const invoice = await prisma.transaction.create({
    data: {
      tenantId,
      partyId: line.partyId,
      type: TransactionType.INVOICE,
      status: "DRAFT",
      amountCents: line.cents,
      subject: `Standing time ${line.arrivedAt.toISOString().slice(0, 16).replace("T", " ")} – ${line.departedAt.toISOString().slice(11, 16)}`,
      itemLines: { create: [{ itemId: item.id, quantity: halfHours, unitPriceCents: unit }] },
    },
  });
  await prisma.tripStop.update({ where: { id: stopId }, data: { detentionBilledOnId: invoice.id } });
  return invoice;
}

// ------------------------------------------------------------------ 144

export async function unbilledRecoverables(tenantId: string) {
  return prisma.expense.findMany({
    where: { tenantId, status: SPENT, recoverable: true, recoveredOnId: null },
    orderBy: { spentOn: "asc" },
    // Oldest first, capped: an operator with three years of never-recovered
    // tolls should be shown the oldest thousand, not handed every row and a
    // six-second page.
    take: 1000,
    select: {
      id: true, descriptionText: true, amountCents: true, spentOn: true, transactionId: true, jobCardId: true,
      transaction: { select: { id: true, partyId: true, party: { select: { name: true } } } },
    },
  });
}

/**
 * Put a customer's recoverable costs onto a DRAFT invoice. Costs tagged to
 * one of their documents are grouped under that customer; untagged ones
 * cannot be billed to anybody and are left for a person.
 */
export async function billRecoverables(tenantId: string, partyId: string) {
  const rows = (await unbilledRecoverables(tenantId)).filter((r) => r.transaction?.partyId === partyId);
  if (rows.length === 0) throw new Error("Nothing recoverable is waiting for that customer.");
  const item = await recoverablesItem(tenantId);
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const invoice = await prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: TransactionType.INVOICE,
      status: "DRAFT",
      amountCents: total,
      subject: "Recoverable costs",
      itemLines: { create: rows.map((r) => ({ itemId: item.id, quantity: 1, unitPriceCents: r.amountCents })) },
    },
  });
  await prisma.expense.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { recoveredOnId: invoice.id } });
  return { invoice, lines: rows.length, totalCents: total };
}

export async function setRecoverable(tenantId: string, expenseId: string, recoverable: boolean) {
  const e = await prisma.expense.findFirst({ where: { id: expenseId, tenantId }, select: { id: true } });
  if (!e) throw new Error("Expense not found.");
  return prisma.expense.update({ where: { id: expenseId }, data: { recoverable } });
}

// ------------------------------------------------------------------ 145

export interface EmptyLeg {
  tripId: string;
  assetId: string;
  assetName: string;
  endedAt: Date;
  destination: string;
  kmFromBase: number | null;
  returnLoaded: boolean;
}

/**
 * Runs that ended away from where the vehicle usually starts, with no loaded
 * run back within three days. The base is inferred — the origin a vehicle
 * leaves from most often — because nobody should have to type it.
 */
export async function emptyRunning(tenantId: string, opts: { since?: Date } = {}): Promise<EmptyLeg[]> {
  const since = opts.since ?? new Date(Date.now() - 30 * DAY);
  // A local run that comes home is not a positioning problem. For a business
  // that does not sell transport, only a run that ended far out counts; a
  // haulier's every one-way leg does.
  const tenantRow = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { niche: true } });
  const haulier = tenantRow?.niche === "LOGISTICS" || tenantRow?.niche === "WHOLESALE";
  const FAR_KM = 80;
  const trips = await prisma.trip.findMany({
    where: { tenantId, assetId: { not: null }, status: { in: ["DONE", "PLANNED", "UNDERWAY"] }, OR: [{ startedAt: { gte: since } }, { plannedAt: { gte: since } }] },
    select: {
      id: true, assetId: true, status: true, startedAt: true, endedAt: true, plannedAt: true,
      originText: true, originLat: true, originLng: true, destinationText: true, destinationLat: true, destinationLng: true,
      asset: { select: { name: true } },
      _count: { select: { stops: true } },
      stops: { select: { transactionId: true, loadKg: true } },
    },
    orderBy: [{ startedAt: "asc" }],
  });

  const byAsset = new Map<string, typeof trips>();
  for (const t of trips) byAsset.set(t.assetId!, [...(byAsset.get(t.assetId!) ?? []), t]);

  const norm = (x: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out: EmptyLeg[] = [];
  for (const [assetId, list] of byAsset) {
    const originCounts = new Map<string, { n: number; lat: number | null; lng: number | null }>();
    for (const t of list) {
      const k = norm(t.originText);
      if (!k) continue;
      const c = originCounts.get(k) ?? { n: 0, lat: t.originLat, lng: t.originLng };
      c.n++;
      originCounts.set(k, c);
    }
    const base = [...originCounts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (!base) continue;

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const dest = norm(t.destinationText);
      if (!dest || dest === base[0] || t.status !== "DONE" || !t.endedAt) continue;
      const window = t.endedAt.getTime() + 3 * DAY;
      const next = list.slice(i + 1).find((n) => (n.startedAt ?? n.plannedAt ?? new Date(0)).getTime() <= window && norm(n.originText) === dest);
      const loaded = Boolean(next && next.stops.some((s) => s.transactionId || (s.loadKg ?? 0) > 0));
      if (loaded) continue;
      const kmFromBase =
        base[1].lat !== null && base[1].lng !== null && t.destinationLat !== null && t.destinationLng !== null
          ? Math.round(haversineKm(base[1].lat, base[1].lng, t.destinationLat, t.destinationLng))
          : null;
      if (!haulier && (kmFromBase === null || kmFromBase < FAR_KM)) continue;
      out.push({ tripId: t.id, assetId, assetName: t.asset?.name ?? "Vehicle", endedAt: t.endedAt, destination: t.destinationText ?? "", kmFromBase, returnLoaded: false });
    }
  }
  return out;
}

// ------------------------------------------------------------------ 146

export interface ConsumptionRow {
  assetId: string;
  assetName: string;
  litres: number;
  km: number;
  per100: number | null;
  /** How far this vehicle's recent consumption sits from its own history. */
  deviationPercent: number | null;
  fills: number;
}

/**
 * Litres per 100 km per vehicle, from odometer readings on fuel slips. The
 * flag is a sustained change against the vehicle's own history — the last
 * four fills together against everything before — never a single tank.
 */
export async function fuelConsumption(tenantId: string): Promise<ConsumptionRow[]> {
  const fills = await prisma.expense.findMany({
    where: { tenantId, status: SPENT, assetId: { not: null }, unit: "L", quantity: { gt: 0 }, odometerKm: { not: null } },
    select: { assetId: true, quantity: true, odometerKm: true, spentOn: true, asset: { select: { name: true } } },
    orderBy: [{ assetId: "asc" }, { odometerKm: "asc" }],
  });
  const byAsset = new Map<string, typeof fills>();
  for (const f of fills) byAsset.set(f.assetId!, [...(byAsset.get(f.assetId!) ?? []), f]);

  const rate = (rows: typeof fills) => {
    if (rows.length < 2) return null;
    const km = rows[rows.length - 1].odometerKm! - rows[0].odometerKm!;
    // Litres to cover a distance are the fills after the first reading.
    const litres = rows.slice(1).reduce((s, r) => s + (r.quantity ?? 0), 0);
    return km > 0 ? { per100: (litres / km) * 100, km, litres } : null;
  };

  const out: ConsumptionRow[] = [];
  for (const [assetId, rows] of byAsset) {
    const all = rate(rows);
    let deviation: number | null = null;
    if (rows.length >= 8) {
      const recent = rate(rows.slice(-5));
      const history = rate(rows.slice(0, -4));
      if (recent && history && history.per100 > 0) deviation = Math.round(((recent.per100 - history.per100) / history.per100) * 100);
    }
    out.push({
      assetId,
      assetName: rows[0].asset?.name ?? "Vehicle",
      litres: all ? Math.round(all.litres) : 0,
      km: all ? all.km : 0,
      per100: all ? Math.round(all.per100 * 10) / 10 : null,
      deviationPercent: deviation,
      fills: rows.length,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 147

export async function currentOdometer(tenantId: string, assetId: string): Promise<number | null> {
  return (await currentOdometers(tenantId, [assetId])).get(assetId) ?? null;
}

/**
 * The highest reading each vehicle has shown, on a slip or at the end of a
 * trip — for a whole fleet in two queries rather than two per vehicle, which
 * is the difference between a fleet page that opens and one that waits.
 */
export async function currentOdometers(tenantId: string, assetIds?: string[]): Promise<Map<string, number>> {
  const scope = assetIds ? { in: assetIds } : { not: null };
  const [slips, trips] = await Promise.all([
    prisma.expense.groupBy({ by: ["assetId"], where: { tenantId, assetId: scope, odometerKm: { not: null } }, _max: { odometerKm: true } }),
    prisma.trip.groupBy({ by: ["assetId"], where: { tenantId, assetId: scope, odometerEndKm: { not: null } }, _max: { odometerEndKm: true } }),
  ]);
  const out = new Map<string, number>();
  const take = (assetId: string | null, km: number | null) => {
    if (!assetId || typeof km !== "number") return;
    out.set(assetId, Math.max(out.get(assetId) ?? km, km));
  };
  for (const s of slips) take(s.assetId, s._max.odometerKm);
  for (const t of trips) take(t.assetId, t._max.odometerEndKm);
  return out;
}

export interface ServiceDue {
  assetId: string;
  assetName: string;
  odometerKm: number;
  dueAtKm: number;
  kmRemaining: number;
  /** Days until due at this vehicle's recent daily distance, when known. */
  daysRemaining: number | null;
}

export async function maintenanceDue(tenantId: string, withinKm = 2_000): Promise<ServiceDue[]> {
  const [assets, odometers, recent] = await Promise.all([
    prisma.asset.findMany({
      where: { tenantId, serviceIntervalKm: { not: null }, status: { notIn: ["LOST", "RETIRED"] } },
      select: { id: true, name: true, serviceIntervalKm: true, lastServiceKm: true },
    }),
    currentOdometers(tenantId),
    prisma.trip.groupBy({
      by: ["assetId"],
      where: { tenantId, assetId: { not: null }, status: "DONE", startedAt: { gte: new Date(Date.now() - 30 * DAY) } },
      _sum: { distanceKm: true },
    }),
  ]);
  const recentKm = new Map(recent.map((r) => [r.assetId, r._sum.distanceKm ?? 0]));
  const out: ServiceDue[] = [];
  for (const a of assets) {
    const odo = odometers.get(a.id);
    if (odo === undefined) continue;
    const dueAt = (a.lastServiceKm ?? 0) + a.serviceIntervalKm!;
    const remaining = dueAt - odo;
    if (remaining > withinKm) continue;
    const perDay = (recentKm.get(a.id) ?? 0) / 30;
    out.push({ assetId: a.id, assetName: a.name, odometerKm: odo, dueAtKm: dueAt, kmRemaining: remaining, daysRemaining: perDay > 0 ? Math.max(0, Math.floor(remaining / perDay)) : null });
  }
  return out.sort((x, y) => x.kmRemaining - y.kmRemaining);
}

export async function recordService(tenantId: string, assetId: string, odometerKm: number) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true } });
  if (!a) throw new Error("Asset not found.");
  return prisma.asset.update({ where: { id: assetId }, data: { lastServiceKm: odometerKm } });
}

export async function setServicePlan(tenantId: string, assetId: string, params: { serviceIntervalKm: number | null; lastServiceKm?: number | null; tareKg?: number | null; maxGrossKg?: number | null }) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true } });
  if (!a) throw new Error("Asset not found.");
  return prisma.asset.update({
    where: { id: assetId },
    data: {
      serviceIntervalKm: params.serviceIntervalKm,
      ...(params.lastServiceKm !== undefined ? { lastServiceKm: params.lastServiceKm } : {}),
      ...(params.tareKg !== undefined ? { tareKg: params.tareKg } : {}),
      ...(params.maxGrossKg !== undefined ? { maxGrossKg: params.maxGrossKg } : {}),
    },
  });
}

// ------------------------------------------------------------------ 148

const CONSUMABLE = /tyre|tire|blade|filter|brake pad|battery|chain|belt|wiper/i;

export interface ConsumableRow {
  assetId: string;
  assetName: string;
  kind: string;
  fitted: number;
  spentCents: number;
  kmCovered: number | null;
  centsPerKm: number | null;
}

/** Tyres, blades and filters fitted against an asset with a reading, as a cost per kilometre. */
export async function consumablesByAsset(tenantId: string): Promise<ConsumableRow[]> {
  const rows = await prisma.expense.findMany({
    where: { tenantId, status: SPENT, assetId: { not: null } },
    select: { assetId: true, descriptionText: true, category: true, amountCents: true, odometerKm: true, asset: { select: { name: true } } },
    orderBy: { spentOn: "asc" },
  });
  const groups = new Map<string, { name: string; kind: string; spent: number; fitted: number; readings: number[] }>();
  for (const r of rows) {
    const hay = `${r.category ?? ""} ${r.descriptionText}`;
    const m = hay.match(CONSUMABLE);
    if (!m) continue;
    const kind = m[0].toLowerCase().replace("tire", "tyre");
    const key = `${r.assetId}|${kind}`;
    const g = groups.get(key) ?? { name: r.asset?.name ?? "Asset", kind, spent: 0, fitted: 0, readings: [] };
    g.spent += r.amountCents;
    g.fitted += 1;
    if (r.odometerKm) g.readings.push(r.odometerKm);
    groups.set(key, g);
  }
  const odometers = groups.size > 0 ? await currentOdometers(tenantId) : new Map<string, number>();
  const out: ConsumableRow[] = [];
  for (const [key, g] of groups) {
    const assetId = key.split("|")[0];
    const odo = odometers.get(assetId) ?? null;
    const first = g.readings.length ? Math.min(...g.readings) : null;
    const km = first !== null && odo !== null && odo > first ? odo - first : null;
    out.push({ assetId, assetName: g.name, kind: g.kind, fitted: g.fitted, spentCents: g.spent, kmCovered: km, centsPerKm: km ? Math.round((g.spent / km) * 100) / 100 : null });
  }
  return out;
}

// ------------------------------------------------------------------ 149

export interface LoadCheck {
  tripId: string;
  assetName: string;
  tareKg: number;
  maxGrossKg: number;
  peakPayloadKg: number;
  peakGrossKg: number;
  overKg: number;
  ok: boolean;
}

/**
 * Walk the stops in order, adding loads and taking off drops, and compare
 * the heaviest point against what the vehicle may weigh loaded. Checked
 * before dispatch, not at the weighbridge.
 */
const LOAD_SELECT = {
  id: true,
  asset: { select: { name: true, tareKg: true, maxGrossKg: true } },
  stops: { orderBy: { sequence: "asc" as const }, select: { loadKg: true } },
};

export async function checkLoad(tenantId: string, tripId: string): Promise<LoadCheck | null> {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, tenantId }, select: LOAD_SELECT });
  return trip ? loadFor(trip) : null;
}

function loadFor(trip: {
  id: string;
  asset: { name: string; tareKg: number | null; maxGrossKg: number | null } | null;
  stops: Array<{ loadKg: number | null }>;
}): LoadCheck | null {
  if (!trip.asset?.tareKg || !trip.asset.maxGrossKg) return null;
  // What was on board leaving the depot is the least that keeps the payload
  // from ever going negative: goods picked up and dropped on the same run are
  // not on board at the start, but anything dropped before it is picked up is.
  let running = 0;
  let lowest = 0;
  for (const s of trip.stops) {
    running += s.loadKg ?? 0;
    lowest = Math.min(lowest, running);
  }
  let payload = -lowest;
  let peak = payload;
  for (const s of trip.stops) {
    payload += s.loadKg ?? 0;
    peak = Math.max(peak, payload);
  }
  const gross = trip.asset.tareKg + peak;
  return {
    tripId: trip.id,
    assetName: trip.asset.name,
    tareKg: trip.asset.tareKg,
    maxGrossKg: trip.asset.maxGrossKg,
    peakPayloadKg: peak,
    peakGrossKg: gross,
    overKg: Math.max(0, gross - trip.asset.maxGrossKg),
    ok: gross <= trip.asset.maxGrossKg,
  };
}

export async function overloadedTrips(tenantId: string): Promise<LoadCheck[]> {
  const trips = await prisma.trip.findMany({
    where: { tenantId, status: { in: ["PLANNED", "UNDERWAY"] }, asset: { tareKg: { not: null }, maxGrossKg: { not: null } } },
    select: LOAD_SELECT,
  });
  return trips.map(loadFor).filter((c): c is LoadCheck => c !== null && !c.ok);
}

export async function setStopLoad(tenantId: string, stopId: string, loadKg: number | null) {
  const s = await prisma.tripStop.findFirst({ where: { id: stopId, tenantId }, select: { id: true } });
  if (!s) throw new Error("Stop not found.");
  return prisma.tripStop.update({ where: { id: stopId }, data: { loadKg } });
}

// ------------------------------------------------------------------ 150

/** Refuses a subcontractor whose work-blocking obligations have lapsed, exactly as an employee is refused. */
export async function assertSubcontractorClear(tenantId: string, partyId: string, now = new Date()) {
  const party = await prisma.party.findFirst({ where: { id: partyId, tenantId }, select: { id: true, role: true } });
  if (!party) throw new Error("Subcontractor not found.");
  const blocking = await blockingObligationsFor(tenantId, { partyId }, now);
  if (blocking.length > 0) throw new WorkBlockedError(blocking);
}

export async function subcontractorsAtRisk(tenantId: string, now = new Date()) {
  const subs = await prisma.party.findMany({ where: { tenantId, role: "SUBCONTRACTOR" }, select: { id: true, name: true } });
  if (subs.length === 0) return [];
  const ids = subs.map((s) => s.id);
  // Every subcontractor's open cover in one read; the lapsed ones are the
  // same rows blockingObligationsFor would return for each of them.
  const open = await prisma.obligation.findMany({
    where: { tenantId, partyId: { in: ids }, status: "OPEN" },
    select: { id: true, partyId: true, title: true, kind: true, dueAt: true, consequence: true, blocksWork: true },
    orderBy: { dueAt: "asc" },
  });
  const out: Array<{ partyId: string; name: string; lapsed: BlockingObligation[]; missingCover: boolean }> = [];
  for (const s of subs) {
    const mine = open.filter((o) => o.partyId === s.id);
    const lapsed = mine
      .filter((o) => o.blocksWork && o.dueAt < now)
      .map((o) => ({ id: o.id, title: o.title, kind: o.kind, dueAt: o.dueAt, daysOverdue: Math.abs(daysBetween(now, o.dueAt)), consequence: o.consequence }));
    const anyCover = mine.some((o) => o.kind === "INSURANCE" || o.kind === "DOCUMENT" || o.kind === "LICENCE");
    if (lapsed.length > 0 || !anyCover) out.push({ partyId: s.id, name: s.name, lapsed, missingCover: !anyCover });
  }
  return out;
}

// ------------------------------------------------------------------ 151

const INCIDENT_NEEDS: Array<{ key: string; label: string; test: (i: { photos: unknown; otherParty: string | null; lat: number | null; description: string }) => boolean }> = [
  { key: "photos", label: "at least three photographs — both vehicles and the scene", test: (i) => Array.isArray(i.photos) && i.photos.length >= 3 },
  { key: "otherParty", label: "the other party's name, number plate and insurer", test: (i) => Boolean(i.otherParty && i.otherParty.trim().length > 5) },
  { key: "location", label: "where it happened", test: (i) => i.lat !== null },
  { key: "description", label: "what happened, in a few sentences", test: (i) => i.description.trim().length >= 40 },
];

export async function reportIncident(params: {
  tenantId: string;
  description: string;
  tripId?: string | null;
  assetId?: string | null;
  driverId?: string | null;
  otherParty?: string | null;
  lat?: number | null;
  lng?: number | null;
  photos?: string[];
  at?: Date;
}) {
  let assetId = params.assetId ?? null;
  let driverId = params.driverId ?? null;
  if (params.tripId) {
    const trip = await prisma.trip.findFirst({ where: { id: params.tripId, tenantId: params.tenantId }, select: { assetId: true, driverId: true } });
    if (!trip) throw new Error("Trip not found.");
    assetId ??= trip.assetId;
    driverId ??= trip.driverId;
  }
  const draft = { photos: params.photos ?? [], otherParty: params.otherParty ?? null, lat: params.lat ?? null, description: params.description };
  const missing = INCIDENT_NEEDS.filter((n) => !n.test(draft)).map((n) => n.label);
  return prisma.incident.create({
    data: {
      tenantId: params.tenantId,
      tripId: params.tripId ?? null,
      assetId,
      driverId,
      at: params.at ?? new Date(),
      lat: params.lat ?? null,
      lng: params.lng ?? null,
      description: params.description,
      otherParty: params.otherParty ?? null,
      photos: params.photos ?? [],
      missing,
    },
  });
}

export async function addToIncident(tenantId: string, incidentId: string, params: { photos?: string[]; otherParty?: string; description?: string; lat?: number; lng?: number }) {
  const inc = await prisma.incident.findFirst({ where: { id: incidentId, tenantId } });
  if (!inc) throw new Error("Incident not found.");
  const photos = [...(Array.isArray(inc.photos) ? (inc.photos as string[]) : []), ...(params.photos ?? [])];
  const next = {
    photos,
    otherParty: params.otherParty ?? inc.otherParty,
    lat: params.lat ?? inc.lat,
    description: params.description ?? inc.description,
  };
  const missing = INCIDENT_NEEDS.filter((n) => !n.test(next)).map((n) => n.label);
  return prisma.incident.update({
    where: { id: incidentId },
    data: { photos, otherParty: next.otherParty, lat: next.lat, lng: params.lng ?? inc.lng, description: next.description, missing },
  });
}

/** The insurer's pack: everything captured, in the order an assessor reads it. */
export async function incidentPack(tenantId: string, incidentId: string) {
  const inc = await prisma.incident.findFirst({
    where: { id: incidentId, tenantId },
    include: { asset: { select: { name: true, registration: true } }, trip: { select: { originText: true, destinationText: true, startedAt: true } } },
  });
  if (!inc) throw new Error("Incident not found.");
  const [driver, cover] = await Promise.all([
    inc.driverId ? prisma.membership.findUnique({ where: { id: inc.driverId }, select: { user: { select: { name: true, email: true } } } }) : null,
    inc.assetId ? prisma.obligation.findFirst({ where: { tenantId, assetId: inc.assetId, kind: "INSURANCE", status: "OPEN" }, select: { title: true, authority: true, reference: true, dueAt: true } }) : null,
  ]);
  return {
    when: inc.at,
    where: inc.lat !== null ? { lat: inc.lat, lng: inc.lng } : null,
    vehicle: inc.asset ? `${inc.asset.name}${inc.asset.registration ? ` (${inc.asset.registration})` : ""}` : null,
    driver: driver?.user.name ?? driver?.user.email ?? null,
    run: inc.trip ? `${inc.trip.originText ?? "?"} → ${inc.trip.destinationText ?? "?"}` : null,
    whatHappened: inc.description,
    otherParty: inc.otherParty,
    photographs: Array.isArray(inc.photos) ? (inc.photos as string[]).length : 0,
    cover: cover ? { policy: cover.title, insurer: cover.authority, number: cover.reference, renews: cover.dueAt } : null,
    stillNeeded: inc.missing,
    complete: inc.missing.length === 0,
  };
}

export async function listIncidents(tenantId: string, take = 30) {
  return prisma.incident.findMany({ where: { tenantId }, orderBy: { at: "desc" }, take, include: { asset: { select: { name: true } } } });
}

// ------------------------------------------------------------------ 152

export interface RouteDeviation {
  tripId: string;
  laneKey: string;
  distanceKm: number;
  laneMedianKm: number;
  deviationPercent: number;
  runsOnLane: number;
}

/**
 * A run on a lane that was unusually long for that lane. Needs five prior
 * runs to know what usual is; flags only beyond both 25% and the lane's own
 * spread, so a lane that is always variable does not cry wolf.
 */
export async function routeDeviations(tenantId: string, opts: { since?: Date } = {}): Promise<RouteDeviation[]> {
  const since = opts.since ?? new Date(Date.now() - 14 * DAY);
  const trips = await prisma.trip.findMany({
    where: { tenantId, status: "DONE", laneKey: { not: null }, distanceKm: { not: null } },
    select: { id: true, laneKey: true, distanceKm: true, plannedKm: true, startedAt: true },
    orderBy: { startedAt: "asc" },
  });
  const byLane = new Map<string, typeof trips>();
  for (const t of trips) byLane.set(t.laneKey!, [...(byLane.get(t.laneKey!) ?? []), t]);

  const out: RouteDeviation[] = [];
  for (const [lane, list] of byLane) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.startedAt || t.startedAt < since) continue;
      const prior = list.slice(0, i).map((x) => x.distanceKm!);
      const expected = t.plannedKm ?? null;
      if (prior.length < 5 && expected === null) continue;
      const sorted = [...prior].sort((a, b) => a - b);
      const median = expected ?? sorted[Math.floor(sorted.length / 2)];
      const mad = sorted.length ? sorted.map((d) => Math.abs(d - median)).sort((a, b) => a - b)[Math.floor(sorted.length / 2)] : 0;
      const dev = t.distanceKm! - median;
      const pct = median > 0 ? Math.round((dev / median) * 100) : 0;
      if (pct < 25 || dev <= 3 * Math.max(mad, 1)) continue;
      out.push({ tripId: t.id, laneKey: lane, distanceKm: t.distanceKm!, laneMedianKm: Math.round(median), deviationPercent: pct, runsOnLane: prior.length });
    }
  }
  return out;
}
