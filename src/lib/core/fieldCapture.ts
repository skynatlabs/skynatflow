// Proof of work, captured where there is no signal.
//
// A driver at a farm gate or a technician in a basement taps "Arrived", takes
// the photograph, gets the signature and taps "Leaving" — usually with no
// signal at all. Each tap is recorded on the phone with the time it actually
// happened and an id made there, queued, and sent when the signal returns.
// This is the server half: it applies each capture exactly once, at the time
// it was captured, not the time it arrived.
//
// Times from a phone are trusted within bounds. A capture dated in the future
// (beyond a few minutes of clock drift) or more than two weeks old is refused,
// because an arrival time is what a detention charge is billed on, and a
// clock that can be set to anything is not evidence.

import { EventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { arriveAtStop, departStop } from "./trips";

const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 14 * 86_400_000;

export type FieldCapture =
  | { id: string; kind: "stop.arrive"; stopId: string; at: string }
  | { id: string; kind: "stop.depart"; stopId: string; at: string }
  | {
      id: string;
      kind: "stop.proof";
      stopId: string;
      at: string;
      photo?: string | null;
      signature?: string | null;
      signedBy?: string | null;
      notes?: string | null;
      lat?: number | null;
      lng?: number | null;
    };

export interface CaptureOutcome {
  id: string;
  status: "applied" | "duplicate" | "refused";
  reason?: string;
}

function checkTime(at: string, now: Date): Date | string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "The capture has no readable time.";
  if (d.getTime() - now.getTime() > MAX_FUTURE_MS) return "The phone's clock is ahead — the capture is dated in the future.";
  if (now.getTime() - d.getTime() > MAX_AGE_MS) return "The capture is more than two weeks old.";
  return d;
}

const isImage = (v: string | null | undefined) => typeof v === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(v) && v.length < 4_000_000;

async function applyOne(tenantId: string, c: FieldCapture, now: Date): Promise<CaptureOutcome> {
  const at = checkTime(c.at, now);
  if (typeof at === "string") return { id: c.id, status: "refused", reason: at };

  const stop = await prisma.tripStop.findFirst({
    where: { id: c.stopId, tenantId },
    select: { id: true, partyId: true, arrivedAt: true, departedAt: true, eventId: true, trip: { select: { purpose: true, status: true } } },
  });
  if (!stop) return { id: c.id, status: "refused", reason: "That stop is not in this workspace." };

  if (c.kind === "stop.arrive") {
    // The earliest arrival wins: a second tap from a nervous thumb is not a
    // later arrival.
    if (stop.arrivedAt && stop.arrivedAt <= at) return { id: c.id, status: "applied", reason: "already arrived earlier" };
    await arriveAtStop(tenantId, stop.id, at);
    return { id: c.id, status: "applied" };
  }

  if (c.kind === "stop.depart") {
    if (stop.departedAt && stop.departedAt >= at) return { id: c.id, status: "applied", reason: "already left later" };
    if (stop.arrivedAt && at < stop.arrivedAt) return { id: c.id, status: "refused", reason: "Left before arriving." };
    await departStop(tenantId, stop.id, { at });
    return { id: c.id, status: "applied" };
  }

  // stop.proof — one proof per stop; a retry after a dropped response finds
  // it already there rather than recording the delivery twice.
  if (stop.eventId) return { id: c.id, status: "applied", reason: "proof already recorded" };
  const photo = isImage(c.photo) ? c.photo! : null;
  const signature = isImage(c.signature) ? c.signature! : null;
  if (!photo && !signature) return { id: c.id, status: "refused", reason: "Proof needs a photograph or a signature." };
  if (!stop.partyId) return { id: c.id, status: "refused", reason: "The stop has no customer to record the proof against." };

  const type = stop.trip.purpose === "SITE_VISIT" ? EventType.SITE_VISIT : stop.trip.purpose === "DELIVERY" || stop.trip.purpose === "COLLECTION" ? EventType.DELIVERY : EventType.INSTALL;
  const notes = [c.signedBy ? `Signed by ${c.signedBy}` : null, c.notes?.trim() || null].filter(Boolean).join(" — ") || null;
  const event = await prisma.event.create({
    data: {
      tenantId,
      partyId: stop.partyId,
      type,
      notes,
      photoUrl: photo,
      signedByUrl: signature,
      gpsLat: Number.isFinite(c.lat) ? c.lat : null,
      gpsLng: Number.isFinite(c.lng) ? c.lng : null,
      createdAt: at,
    },
  });
  await prisma.tripStop.update({ where: { id: stop.id }, data: { eventId: event.id, arrivedAt: stop.arrivedAt ?? at } });
  return { id: c.id, status: "applied" };
}

/**
 * Apply a batch of captures from a phone, each exactly once.
 *
 * The phone's id is claimed before the capture is applied: the insert is on a
 * unique key, so when two requests carrying the same capture arrive together
 * — several stops on one screen all syncing the moment signal returns — only
 * one claim succeeds and only that request applies it. A refused or failed
 * capture releases its claim. Underneath that, each capture is safe to apply
 * twice on its own terms — the earliest arrival stands, the latest departure
 * stands, a stop takes one proof.
 */
export async function applyFieldCaptures(tenantId: string, captures: FieldCapture[], now = new Date()): Promise<CaptureOutcome[]> {
  const out: CaptureOutcome[] = [];
  // In the order they happened on the phone, so an arrival lands before the
  // departure that follows it whatever order the network delivered them in.
  const ordered = [...captures].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  for (const c of ordered) {
    if (typeof c.id !== "string" || c.id.length < 8 || c.id.length > 64) {
      out.push({ id: String(c.id), status: "refused", reason: "Missing capture id." });
      continue;
    }
    const capturedAt = new Date(c.at);
    try {
      await prisma.fieldSync.create({ data: { id: c.id, tenantId, kind: String(c.kind), capturedAt: Number.isNaN(capturedAt.getTime()) ? now : capturedAt } });
    } catch {
      // Unique key taken: this capture was claimed by another request, or by
      // another workspace's phone generating the same id (refused).
      const seen = await prisma.fieldSync.findUnique({ where: { id: c.id }, select: { tenantId: true } });
      out.push({ id: c.id, status: seen && seen.tenantId === tenantId ? "duplicate" : "refused" });
      continue;
    }
    try {
      const outcome = await applyOne(tenantId, c, now);
      if (outcome.status === "applied") {
        await prisma.fieldSync.update({ where: { id: c.id }, data: { result: outcome.reason ?? null } });
      } else {
        await prisma.fieldSync.delete({ where: { id: c.id } }).catch(() => undefined);
      }
      out.push(outcome);
    } catch (err) {
      await prisma.fieldSync.delete({ where: { id: c.id } }).catch(() => undefined);
      out.push({ id: c.id, status: "refused", reason: err instanceof Error ? err.message : "Could not apply." });
    }
  }
  return out;
}
