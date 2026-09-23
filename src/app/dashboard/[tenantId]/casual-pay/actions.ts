"use server";

import { revalidatePath } from "next/cache";
import { CasualPayKind } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { saveFieldWorker, logWork, approveWork, markPaid } from "@/lib/core/casualPay";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/casual-pay`);
}

export async function saveWorkerAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await saveFieldWorker({
    tenantId,
    workerId: String(formData.get("workerId") ?? "") || undefined,
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    idNumber: String(formData.get("idNumber") ?? "") || null,
    payKind: String(formData.get("payKind") ?? "DAILY") as CasualPayKind,
    rateCents: Math.round(Number(formData.get("rate") ?? 0) * 100),
    payoutNumber: String(formData.get("payoutNumber") ?? "") || null,
  });

  refresh(tenantId);
}

export async function logWorkAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "staff:manage");

  await logWork({
    tenantId,
    fieldWorkerId: String(formData.get("fieldWorkerId")),
    workedOn: new Date(String(formData.get("workedOn"))),
    units: Number(formData.get("units") ?? 1),
    note: String(formData.get("note") ?? "") || null,
  });

  refresh(tenantId);
}

/** The gate between a clipboard and money leaving a tin. Audited. */
export async function approveWorkAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");
  if (!access.membershipId) throw new Error("Only somebody on the team can approve work.");

  const ids = formData.getAll("workLogId").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const approved = await approveWork({ tenantId, workLogIds: ids, approvedById: access.membershipId });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "WorkLog",
    targetId: ids[0],
    metadata: { approved, ids },
  });

  refresh(tenantId);
}

export async function markPaidAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "payment:record");

  const ids = formData.getAll("workLogId").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const result = await markPaid({ tenantId, workLogIds: ids });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "WorkLog",
    targetId: ids[0],
    metadata: { marked: result.marked, skipped: result.skipped },
  });

  refresh(tenantId);
}
