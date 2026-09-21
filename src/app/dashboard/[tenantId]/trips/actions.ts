"use server";

import { revalidatePath } from "next/cache";
import { TripPurpose } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  startTrip,
  endTrip,
  addStop,
  arriveAtStop,
  departStop,
  cancelTrip,
  appendTripPoints,
  recordConsent,
} from "@/lib/core/trips";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/trips`);
  revalidatePath(`/dashboard/${tenantId}/costs`);
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function startTripAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");

  const stops: Array<{ partyId: string | null; label: string | null; addressText: string | null }> = [];
  for (let i = 0; i < 6; i++) {
    const partyId = String(formData.get(`stop${i}Party`) ?? "").trim() || null;
    const label = String(formData.get(`stop${i}Label`) ?? "").trim() || null;
    const addressText = String(formData.get(`stop${i}Address`) ?? "").trim() || null;
    if (partyId || label || addressText) stops.push({ partyId, label, addressText });
  }

  await startTrip({
    tenantId,
    assetId: String(formData.get("assetId") ?? "").trim() || null,
    driverId: String(formData.get("driverId") ?? "").trim() || access.membershipId,
    purpose: (String(formData.get("purpose") ?? "OTHER") as TripPurpose) || TripPurpose.OTHER,
    originText: String(formData.get("originText") ?? "").trim() || null,
    destinationText: String(formData.get("destinationText") ?? "").trim() || null,
    odometerStartKm: num(formData.get("odometerStartKm")),
    planOnly: formData.get("planOnly") === "on",
    stops,
  });
  refresh(tenantId);
}

export async function endTripAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  await endTrip(tenantId, String(formData.get("tripId") ?? ""), {
    odometerEndKm: num(formData.get("odometerEndKm")),
    distanceKm: num(formData.get("distanceKm")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  refresh(tenantId);
}

export async function cancelTripAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  await cancelTrip(tenantId, String(formData.get("tripId") ?? ""));
  refresh(tenantId);
}

export async function addStopAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  await addStop(tenantId, String(formData.get("tripId") ?? ""), {
    partyId: String(formData.get("partyId") ?? "").trim() || null,
    label: String(formData.get("label") ?? "").trim() || null,
    addressText: String(formData.get("addressText") ?? "").trim() || null,
  });
  refresh(tenantId);
}

export async function arriveAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  await arriveAtStop(tenantId, String(formData.get("stopId") ?? ""));
  refresh(tenantId);
}

export async function departAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  await departStop(tenantId, String(formData.get("stopId") ?? ""));
  refresh(tenantId);
}

/**
 * Positions from the phone, in batches. Called from the tracker component
 * while a trip is underway; the core refuses them without the driver's
 * dated consent, whatever the client claims.
 */
export async function appendPointsAction(
  tenantId: string,
  tripId: string,
  points: Array<{ at: string; lat: number; lng: number; accuracyM?: number | null }>
) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "delivery:log");
  return appendTripPoints(
    tenantId,
    tripId,
    points.map((p) => ({ at: new Date(p.at), lat: p.lat, lng: p.lng, accuracyM: p.accuracyM ?? null }))
  );
}

/** The person's own consent to movement tracking — theirs to give and to withdraw. */
export async function consentAction(tenantId: string, granted: boolean) {
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");
  await recordConsent(tenantId, access.membershipId, granted);
  refresh(tenantId);
}
