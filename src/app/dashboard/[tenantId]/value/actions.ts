"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { prisma } from "@/lib/db";

/** What the platform charges this workspace a month, so the ledger has a cost to set against value. */
export async function setMonthlyFeeAction(tenantId: string, formData: FormData) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  const raw = String(formData.get("monthlyFee") ?? "").trim();
  const cents = raw ? Math.round(Number(raw) * 100) : null;
  if (cents !== null && (!Number.isFinite(cents) || cents < 0)) throw new Error("That is not an amount.");
  await prisma.tenant.update({ where: { id: tenantId }, data: { monthlyFeeCents: cents } });
  revalidatePath(`/dashboard/${tenantId}/value`);
}
