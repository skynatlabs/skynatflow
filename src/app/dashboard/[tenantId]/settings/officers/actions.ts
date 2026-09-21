"use server";

import { revalidatePath } from "next/cache";
import { Officer } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { setCeiling, RUNGS, type Rung } from "@/lib/agent/ladder";
import { setTurnaroundMode } from "@/lib/core/industryPacks";

/**
 * Change how far one officer may go on its own.
 *
 * Owner-only, because this is the setting that decides whether something can
 * happen to a customer without a person seeing it first. setCeiling() still
 * applies the hard caps, so a crafted form post cannot give the CEO hands.
 */
export async function updateCeiling(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  const officer = String(formData.get("officer") ?? "") as Officer;
  const ceiling = String(formData.get("ceiling") ?? "") as Rung;

  if (!Object.values(Officer).includes(officer)) throw new Error("No such officer.");
  if (!RUNGS.includes(ceiling)) throw new Error("No such autonomy level.");

  await setCeiling({ tenantId, officer, ceiling });

  revalidatePath(`/dashboard/${tenantId}/settings/officers`);
  revalidatePath(`/dashboard/${tenantId}/brief`);
}

/** Cash first, everything else second — for a business genuinely in trouble. */
export async function turnaroundAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");
  await setTurnaroundMode(tenantId, formData.get("on") === "true");
  revalidatePath(`/dashboard/${tenantId}/settings/officers`);
  revalidatePath(`/dashboard/${tenantId}/brief`);
}
