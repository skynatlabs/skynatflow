"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { closePeriod, ensureChartOfAccounts, reopenPeriod } from "@/lib/core/ledger";
import { backfillLedger } from "@/lib/core/ledgerBackfill";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // The books are an owner-level surface. Closing a month changes what the
  // business can still report on, and posting history changes every figure
  // downstream of it.
  assertCan(access.role, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/books`);
  revalidatePath(`/dashboard/${tenantId}`);
}

export async function startBooksAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);
  await ensureChartOfAccounts(tenantId);
  await backfillLedger(tenantId);
  refresh(tenantId);
}

export async function backfillAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);
  await backfillLedger(tenantId);
  refresh(tenantId);
}

export async function closePeriodAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  const [yearRaw, monthRaw] = String(formData.get("period") ?? "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Pick a month to close.");
  }

  await closePeriod({ tenantId, year, month, closedBy: access.userId });
  refresh(tenantId);
}

/**
 * Reopen a month.
 *
 * Kept as a deliberate, human-only action — no agent tool exposes it. A
 * closed month is what makes the agent's autonomy safe, and an agent able to
 * unlock it would make the guarantee worthless.
 */
export async function reopenPeriodAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error("Which month?");

  await reopenPeriod(tenantId, year, month);
  refresh(tenantId);
}
