"use server";

import { redirect } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { markArrivalShown } from "@/lib/agent/arrival";

export async function finishArrivalAction(tenantId: string) {
  await requireTenantAccess(tenantId);
  await markArrivalShown(tenantId);
  redirect(`/dashboard/${tenantId}/brief`);
}
