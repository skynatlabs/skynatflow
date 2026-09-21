"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { runMonthlyDepreciation } from "@/lib/core/depreciation";
import { accrueExpense, deferRevenue } from "@/lib/core/accruals";
import { monthEndPack } from "@/lib/core/bookkeeper";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/books/month-end`);
  revalidatePath(`/dashboard/${tenantId}/books`);
}

export async function runDepreciationAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!year || !month) throw new Error("Which month?");
  await runMonthlyDepreciation(tenantId, year, month);
  refresh(tenantId);
}

/** Do the month's bookkeeping: post what has not reached the books and charge depreciation. */
export async function runMonthEndAction(tenantId: string, formData: FormData) {
  await guard(tenantId);
  await monthEndPack(tenantId, Number(formData.get("year")), Number(formData.get("month")), { post: true });
  refresh(tenantId);
}

export async function accrueAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const on = String(formData.get("on") ?? "");
  const amount = Number(formData.get("amount"));
  await accrueExpense({
    tenantId,
    on: new Date(`${on}T12:00:00Z`),
    amountCents: Math.round(amount * 100),
    expenseAccountCode: String(formData.get("accountCode") ?? "5900"),
    memo: String(formData.get("memo") ?? "").trim() || "Accrued cost",
    createdById: access.membershipId,
  });
  refresh(tenantId);
}

export async function deferAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const amount = Number(formData.get("amount"));
  await deferRevenue({
    tenantId,
    on: new Date(`${String(formData.get("on"))}T12:00:00Z`),
    earnedOn: new Date(`${String(formData.get("earnedOn"))}T12:00:00Z`),
    amountCents: Math.round(amount * 100),
    memo: String(formData.get("memo") ?? "").trim() || "Income received in advance",
    createdById: access.membershipId,
  });
  refresh(tenantId);
}
