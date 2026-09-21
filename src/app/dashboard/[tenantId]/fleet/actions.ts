"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import {
  billDetention,
  billRecoverables,
  recordService,
  setServicePlan,
  reportIncident,
  addToIncident,
} from "@/lib/core/fleetOps";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/fleet`);
  revalidatePath(`/dashboard/${tenantId}/invoices`);
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? Number(s) : null;
};

export async function billDetentionAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "invoice:create");
  await billDetention(tenantId, String(formData.get("stopId")));
  refresh(tenantId);
}

export async function billRecoverablesAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "invoice:create");
  await billRecoverables(tenantId, String(formData.get("partyId")));
  refresh(tenantId);
}

export async function recordServiceAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "product:manage");
  const odo = num(formData.get("odometerKm"));
  if (odo === null) throw new Error("What did the odometer read?");
  await recordService(tenantId, String(formData.get("assetId")), odo);
  refresh(tenantId);
}

export async function setSpecAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "product:manage");
  await setServicePlan(tenantId, String(formData.get("assetId")), {
    serviceIntervalKm: num(formData.get("serviceIntervalKm")),
    lastServiceKm: num(formData.get("lastServiceKm")),
    tareKg: num(formData.get("tareKg")),
    maxGrossKg: num(formData.get("maxGrossKg")),
  });
  refresh(tenantId);
}

export async function setDetentionRateAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "staff:manage");
  const rate = num(formData.get("ratePerHour"));
  const free = num(formData.get("freeMinutes"));
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { detentionRateCents: rate === null ? null : Math.round(rate * 100), ...(free !== null ? { detentionFreeMinutes: free } : {}) },
  });
  refresh(tenantId);
}

export async function reportIncidentAction(tenantId: string, formData: FormData) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "delivery:log");
  const photos = String(formData.get("photos") ?? "").split("\n").map((p) => p.trim()).filter((p) => p.startsWith("data:image/"));
  await reportIncident({
    tenantId,
    description: String(formData.get("description") ?? "").trim(),
    assetId: String(formData.get("assetId") ?? "").trim() || null,
    driverId: a.membershipId,
    otherParty: String(formData.get("otherParty") ?? "").trim() || null,
    lat: num(formData.get("lat")),
    lng: num(formData.get("lng")),
    photos,
  });
  refresh(tenantId);
}

export async function addIncidentPhotosAction(tenantId: string, incidentId: string, photos: string[]) {
  const a = await requireTenantAccess(tenantId);
  assertCan(a, "delivery:log");
  await addToIncident(tenantId, incidentId, { photos: photos.filter((p) => p.startsWith("data:image/")) });
  refresh(tenantId);
}
