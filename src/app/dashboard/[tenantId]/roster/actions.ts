"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { saveWorkSite, saveShift, deleteShift } from "@/lib/core/workforce";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/roster`);
}

export async function saveSiteAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "task:manage");

  const num = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };

  await saveWorkSite({
    tenantId,
    name: String(formData.get("name") ?? ""),
    lat: num("lat"),
    lng: num("lng"),
    radiusMetres: num("radiusMetres") ?? 150,
    landmark: String(formData.get("landmark") ?? "") || null,
  });

  refresh(tenantId);
}

export async function saveShiftAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  const rate = String(formData.get("ratePerHour") ?? "").trim();

  await saveShift({
    tenantId,
    workSiteId: String(formData.get("workSiteId") ?? "") || null,
    membershipId: String(formData.get("membershipId") ?? "") || null,
    startsAt: new Date(String(formData.get("startsAt"))),
    endsAt: new Date(String(formData.get("endsAt"))),
    role: String(formData.get("role") ?? "") || null,
    ratePerHourCents: rate === "" ? null : Math.round(Number(rate) * 100),
  });

  refresh(tenantId);
}

export async function deleteShiftAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await deleteShift(tenantId, String(formData.get("shiftId")));
  refresh(tenantId);
}
