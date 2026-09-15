// Trips — the object every logistics calculation hangs from.
//
// A trip is something moving to do work: a truck to Durban with three drops,
// an electrician to four jobs, a crew to a site for the day. It carries who,
// what, from, to, how far and how long; its stops carry what was done where
// and the proof of it; fuel and tolls hang off it as expenses. Cost per
// kilometre divides by its distance, margin per job reads its stops, and the
// consolidation engine notices three of them going to the same suburb in one
// week.
//
// Distance is the number everything depends on and the one nobody wants to
// type, so it is taken from whatever is most trustworthy: an odometer pair if
// there is one, the phone's track if there was one, a typed figure if that is
// all there is. Which one it was is stored beside it, because a cost per
// kilometre built on a guess should say so.

import {
  DistanceSource,
  TripPurpose,
  TripStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";

// ----------------------------------------------------------------- helpers

/** "Johannesburg", "JHB " and "johannesburg." are one place. */
export function normalisePlace(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return t || null;
}

/**
 * One key per lane, direction-aware: the run down is not the run back, and a
 * lane report that merged them would hide the empty return leg — which is
 * the single most expensive thing in road freight.
 */
export function laneKeyFor(origin: string | null | undefined, destination: string | null | undefined): string | null {
  const o = normalisePlace(origin);
  const d = normalisePlace(destination);
  if (!o || !d) return null;
  return `${o} > ${d}`;
}

const EARTH_KM = 6371;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance along a recorded track.
 *
 * Points closer together than the phone's own accuracy are noise, not
 * movement — a parked van with a jittery fix would otherwise "drive" a
 * kilometre an hour standing still. Anything under the floor is skipped.
 */
export function trackDistanceKm(
  points: Array<{ lat: number; lng: number; accuracyM?: number | null }>,
  floorM = 15
): number {
  let km = 0;
  let last: { lat: number; lng: number } | null = null;
  for (const p of points) {
    if (last) {
      const leg = haversineKm(last.lat, last.lng, p.lat, p.lng);
      const floor = Math.max(floorM, p.accuracyM ?? 0) / 1000;
      if (leg >= floor) {
        km += leg;
        last = p;
      }
    } else {
      last = p;
    }
  }
  return Math.round(km * 10) / 10;
}

async function requireTrip(tenantId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, tenantId } });
  if (!trip) throw new Error("Trip not found.");
  return trip;
}

async function requireOwnedIds(
  tenantId: string,
  ids: { assetId?: string | null; driverId?: string | null; partyId?: string | null; transactionId?: string | null; jobCardId?: string | null }
) {
  if (ids.assetId) {
    const a = await prisma.asset.findFirst({ where: { id: ids.assetId, tenantId }, select: { id: true } });
    if (!a) throw new Error("Vehicle not found.");
  }
  if (ids.driverId) {
    const m = await prisma.membership.findFirst({ where: { id: ids.driverId, tenantId }, select: { id: true } });
    if (!m) throw new Error("Driver not found.");
  }
  if (ids.partyId) {
    const p = await prisma.party.findFirst({ where: { id: ids.partyId, tenantId }, select: { id: true } });
    if (!p) throw new Error("Customer not found.");
  }
  if (ids.transactionId) {
    const t = await prisma.transaction.findFirst({ where: { id: ids.transactionId, tenantId }, select: { id: true } });
    if (!t) throw new Error("Document not found.");
  }
  if (ids.jobCardId) {
    const j = await prisma.jobCard.findFirst({ where: { id: ids.jobCardId, tenantId }, select: { id: true } });
    if (!j) throw new Error("Job card not found.");
  }
}

// ------------------------------------------------------------------ writes

export interface StartTripParams {
  tenantId: string;
  assetId?: string | null;
  driverId?: string | null;
  purpose?: TripPurpose;
  originText?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destinationText?: string | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
  odometerStartKm?: number | null;
  plannedAt?: Date | null;
  /** True to create it as a plan rather than something underway now. */
  planOnly?: boolean;
  startedAt?: Date;
  notes?: string | null;
  branchId?: string | null;
  stops?: AddStopParams[];
}

export interface AddStopParams {
  partyId?: string | null;
  transactionId?: string | null;
  jobCardId?: string | null;
  label?: string | null;
  addressText?: string | null;
  lat?: number | null;
  lng?: number | null;
  plannedAt?: Date | null;
}

/**
 * Start a trip, or plan one.
 *
 * A stop can name the customer, the invoice being delivered or the job card
 * being worked; whichever is given, the others are filled from it, so a
 * driver picking "Acme's invoice" has tagged the stop to the customer too.
 */
export async function startTrip(params: StartTripParams) {
  const { tenantId } = params;
  await requireOwnedIds(tenantId, { assetId: params.assetId, driverId: params.driverId });

  // A vehicle already underway cannot start a second run; the first one has
  // to end. Otherwise the same kilometres get counted twice.
  if (params.assetId && !params.planOnly) {
    const open = await prisma.trip.findFirst({
      where: { tenantId, assetId: params.assetId, status: TripStatus.UNDERWAY },
      select: { id: true },
    });
    if (open) throw new Error("That vehicle is already on a trip. End it first.");
  }

  const stops = await resolveStops(tenantId, params.stops ?? []);

  return prisma.trip.create({
    data: {
      tenantId,
      assetId: params.assetId ?? null,
      driverId: params.driverId ?? null,
      purpose: params.purpose ?? TripPurpose.OTHER,
      status: params.planOnly ? TripStatus.PLANNED : TripStatus.UNDERWAY,
      originText: params.originText?.trim() || null,
      originLat: params.originLat ?? null,
      originLng: params.originLng ?? null,
      destinationText: params.destinationText?.trim() || null,
      destinationLat: params.destinationLat ?? null,
      destinationLng: params.destinationLng ?? null,
      laneKey: laneKeyFor(params.originText, params.destinationText),
      plannedAt: params.plannedAt ?? null,
      startedAt: params.planOnly ? null : (params.startedAt ?? new Date()),
      odometerStartKm: params.odometerStartKm ?? null,
      notes: params.notes?.trim() || null,
      branchId: params.branchId ?? null,
      stops: stops.length > 0 ? { create: stops } : undefined,
    },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });
}

async function resolveStops(tenantId: string, stops: AddStopParams[], startAt = 0) {
  const out: Prisma.TripStopCreateWithoutTripInput[] = [];
  let seq = startAt;
  for (const s of stops) {
    await requireOwnedIds(tenantId, {
      partyId: s.partyId,
      transactionId: s.transactionId,
      jobCardId: s.jobCardId,
    });
    let partyId = s.partyId ?? null;
    let transactionId = s.transactionId ?? null;
    if (s.jobCardId && (!partyId || !transactionId)) {
      const job = await prisma.jobCard.findUnique({
        where: { id: s.jobCardId },
        select: { partyId: true, transactionId: true },
      });
      partyId ??= job?.partyId ?? null;
      transactionId ??= job?.transactionId ?? null;
    }
    if (transactionId && !partyId) {
      const doc = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { partyId: true },
      });
      partyId = doc?.partyId ?? null;
    }
    out.push({
      tenant: { connect: { id: tenantId } },
      sequence: seq++,
      party: partyId ? { connect: { id: partyId } } : undefined,
      transaction: transactionId ? { connect: { id: transactionId } } : undefined,
      jobCard: s.jobCardId ? { connect: { id: s.jobCardId } } : undefined,
      label: s.label?.trim() || null,
      addressText: s.addressText?.trim() || null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      plannedAt: s.plannedAt ?? null,
    });
  }
  return out;
}

export async function addStop(tenantId: string, tripId: string, stop: AddStopParams) {
  const trip = await requireTrip(tenantId, tripId);
  if (trip.status === TripStatus.DONE || trip.status === TripStatus.CANCELLED) {
    throw new Error("That trip is over.");
  }
  const last = await prisma.tripStop.findFirst({
    where: { tripId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const [data] = await resolveStops(tenantId, [stop], (last?.sequence ?? -1) + 1);
  return prisma.tripStop.create({ data: { ...data, trip: { connect: { id: tripId } } } });
}

/** Set a planned trip going. */
export async function beginTrip(tenantId: string, tripId: string, opts: { odometerStartKm?: number | null; at?: Date } = {}) {
  const trip = await requireTrip(tenantId, tripId);
  if (trip.status !== TripStatus.PLANNED) throw new Error("Only a planned trip can be started.");
  return prisma.trip.update({
    where: { id: tripId },
    data: {
      status: TripStatus.UNDERWAY,
      startedAt: opts.at ?? new Date(),
      odometerStartKm: opts.odometerStartKm ?? trip.odometerStartKm,
    },
  });
}

/**
 * Arrived at a stop. The time is the proof-of-work time; the event, when one
 * is logged for the stop, is the photograph or signature.
 */
export async function arriveAtStop(tenantId: string, stopId: string, at = new Date()) {
  const stop = await prisma.tripStop.findFirst({ where: { id: stopId, tenantId } });
  if (!stop) throw new Error("Stop not found.");
  return prisma.tripStop.update({ where: { id: stopId }, data: { arrivedAt: at } });
}

export async function departStop(
  tenantId: string,
  stopId: string,
  opts: { at?: Date; eventId?: string | null } = {}
) {
  const stop = await prisma.tripStop.findFirst({ where: { id: stopId, tenantId } });
  if (!stop) throw new Error("Stop not found.");
  if (opts.eventId) {
    const ev = await prisma.event.findFirst({ where: { id: opts.eventId, tenantId }, select: { id: true } });
    if (!ev) throw new Error("Proof event not found.");
  }
  const at = opts.at ?? new Date();
  return prisma.tripStop.update({
    where: { id: stopId },
    data: {
      departedAt: at,
      // Leaving somewhere you never arrived is a data-entry gap, not a
      // physics claim; fill the arrival so time-on-site reads as zero rather
      // than as undefined.
      arrivedAt: stop.arrivedAt ?? at,
      eventId: opts.eventId ?? stop.eventId,
    },
  });
}

/**
 * Positions from the phone while a trip is underway.
 *
 * Refused without the driver's dated consent. The points are the person's
 * movement, and the platform's only use for them is the distance — so that
 * is all it derives, and the raw points are exported to the business and
 * never reported on.
 */
export async function appendTripPoints(
  tenantId: string,
  tripId: string,
  points: Array<{ at: Date; lat: number; lng: number; accuracyM?: number | null }>
) {
  const trip = await requireTrip(tenantId, tripId);
  if (trip.status !== TripStatus.UNDERWAY) throw new Error("That trip is not underway.");
  if (!trip.driverId) throw new Error("A trip needs a driver before it can be tracked.");

  const driver = await prisma.membership.findUnique({
    where: { id: trip.driverId },
    select: { locationConsentAt: true },
  });
  if (!driver?.locationConsentAt) {
    throw new Error("The driver has not agreed to movement tracking.");
  }

  const clean = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
  if (clean.length === 0) return { added: 0 };

  await prisma.tripPoint.createMany({
    data: clean.map((p) => ({ tripId, at: p.at, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM ?? null })),
  });
  return { added: clean.length };
}

export async function recordConsent(tenantId: string, membershipId: string, granted: boolean) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
  if (!m) throw new Error("Team member not found.");
  return prisma.membership.update({
    where: { id: membershipId },
    data: { locationConsentAt: granted ? new Date() : null },
  });
}

export interface EndTripParams {
  odometerEndKm?: number | null;
  /** A figure typed by the driver, used only when nothing better exists. */
  distanceKm?: number | null;
  at?: Date;
  notes?: string | null;
}

/**
 * End a trip and settle its distance.
 *
 * Preference order is trust order: an odometer pair, then the phone's track,
 * then a typed figure. Whichever won is recorded beside the number. A trip
 * that ends with no distance at all is allowed — the run happened — and is
 * simply left out of every per-kilometre figure rather than pulling them
 * towards zero.
 */
export async function endTrip(tenantId: string, tripId: string, params: EndTripParams = {}) {
  const trip = await requireTrip(tenantId, tripId);
  if (trip.status === TripStatus.DONE) throw new Error("That trip has already ended.");
  if (trip.status === TripStatus.CANCELLED) throw new Error("That trip was cancelled.");

  const at = params.at ?? new Date();
  const odometerEndKm = params.odometerEndKm ?? null;

  let distanceKm: number | null = null;
  let distanceSource: DistanceSource | null = null;

  if (trip.odometerStartKm !== null && odometerEndKm !== null) {
    if (odometerEndKm < trip.odometerStartKm) {
      throw new Error("The odometer cannot have gone backwards.");
    }
    distanceKm = odometerEndKm - trip.odometerStartKm;
    distanceSource = DistanceSource.ODOMETER;
  }

  if (distanceKm === null) {
    const points = await prisma.tripPoint.findMany({
      where: { tripId },
      orderBy: { at: "asc" },
      select: { lat: true, lng: true, accuracyM: true },
    });
    if (points.length >= 2) {
      distanceKm = trackDistanceKm(points);
      distanceSource = DistanceSource.GPS;
    }
  }

  if (distanceKm === null && params.distanceKm !== null && params.distanceKm !== undefined) {
    if (params.distanceKm < 0) throw new Error("A distance cannot be negative.");
    distanceKm = params.distanceKm;
    distanceSource = DistanceSource.TYPED;
  }

  return prisma.trip.update({
    where: { id: tripId },
    data: {
      status: TripStatus.DONE,
      endedAt: at,
      startedAt: trip.startedAt ?? at,
      odometerEndKm,
      distanceKm,
      distanceSource,
      notes: params.notes?.trim() || trip.notes,
    },
    include: { stops: { orderBy: { sequence: "asc" } } },
  });
}

export async function cancelTrip(tenantId: string, tripId: string) {
  await requireTrip(tenantId, tripId);
  return prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.CANCELLED } });
}

// ------------------------------------------------------------------- reads

export async function listTrips(
  tenantId: string,
  opts: { status?: TripStatus; assetId?: string; driverId?: string; since?: Date; take?: number } = {}
) {
  return prisma.trip.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.assetId ? { assetId: opts.assetId } : {}),
      ...(opts.driverId ? { driverId: opts.driverId } : {}),
      ...(opts.since ? { OR: [{ startedAt: { gte: opts.since } }, { plannedAt: { gte: opts.since } }] } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 50,
    include: {
      asset: { select: { id: true, name: true, registration: true } },
      driver: { select: { id: true, user: { select: { name: true, email: true } } } },
      stops: {
        orderBy: { sequence: "asc" },
        include: { party: { select: { name: true } } },
      },
      _count: { select: { expenses: true, points: true } },
    },
  });
}

export async function getTrip(tenantId: string, tripId: string) {
  return prisma.trip.findFirst({
    where: { id: tripId, tenantId },
    include: {
      asset: { select: { id: true, name: true, registration: true, capacityUnit: true } },
      driver: { select: { id: true, costRateCents: true, user: { select: { name: true, email: true } } } },
      stops: { orderBy: { sequence: "asc" }, include: { party: { select: { name: true } } } },
      expenses: { where: { status: { notIn: ["REJECTED", "DUPLICATE"] } } },
      _count: { select: { points: true } },
    },
  });
}

/** Hours between start and end, or null while underway. */
export function tripHours(trip: { startedAt: Date | null; endedAt: Date | null }): number | null {
  if (!trip.startedAt || !trip.endedAt) return null;
  return Math.max(0, (trip.endedAt.getTime() - trip.startedAt.getTime()) / 3_600_000);
}
