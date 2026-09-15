"use server";

import { revalidatePath } from "next/cache";
import { ExpenseSource } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  submitExpense,
  approveExpense,
  rejectExpense,
  classifyExpense,
  markDuplicate,
  keepBoth,
} from "@/lib/core/expenses";
import { readReceipt, readingToFields } from "@/lib/ai/receipt";
import type { ReadFields } from "./CaptureForm";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/expenses`);
  revalidatePath(`/dashboard/${tenantId}/costs`);
}

function money(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function submitExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  const descriptionText = String(formData.get("descriptionText") ?? "").trim();
  const amountCents = money(formData.get("amountRand"));
  if (!descriptionText || !amountCents || amountCents <= 0) throw new Error("Description and amount are required.");

  const receiptDataUrl = String(formData.get("receiptDataUrl") ?? "").trim() || undefined;
  const spentOnRaw = String(formData.get("spentOn") ?? "").trim();
  const spentOn = spentOnRaw ? new Date(`${spentOnRaw}T12:00:00.000Z`) : undefined;
  if (spentOn && Number.isNaN(spentOn.getTime())) throw new Error("Couldn't read that date.");
  const drawing = String(formData.get("isOwnerDrawing") ?? "");
  const odo = String(formData.get("odometerKm") ?? "").trim();

  // A photograph is a photograph whichever device took it; the camera source
  // is claimed when a slip was read, the upload source when one was simply
  // attached, and the desk when there was none.
  const source: ExpenseSource = receiptDataUrl
    ? String(formData.get("receiptRead") ?? "") === "yes"
      ? ExpenseSource.CAMERA
      : ExpenseSource.UPLOAD
    : ExpenseSource.DESKTOP;

  await submitExpense({
    tenantId,
    submittedById: access.membershipId,
    descriptionText,
    amountCents,
    category: String(formData.get("category") ?? "").trim() || undefined,
    receiptDataUrl,
    spentOn,
    source,
    supplierName: String(formData.get("supplierName") ?? "").trim() || null,
    taxCents: money(formData.get("taxRand")),
    reference: String(formData.get("reference") ?? "").trim() || null,
    assetId: String(formData.get("assetId") ?? "").trim() || null,
    tripId: String(formData.get("tripId") ?? "").trim() || null,
    jobCardId: String(formData.get("jobCardId") ?? "").trim() || null,
    odometerKm: odo ? Number(odo) : null,
    isOwnerDrawing: drawing === "true" ? true : drawing === "false" ? false : null,
    recoverable: formData.get("recoverable") === "on",
  });
  refresh(tenantId);
}

/**
 * Read a slip image into fields for the capture form. Nothing is written;
 * the person confirms what was read before anything is recorded.
 */
export async function readSlipAction(tenantId: string, dataUrl: string): Promise<ReadFields | null> {
  await requireTenantAccess(tenantId);
  const reading = await readReceipt(dataUrl);
  if (!reading) return null;
  const f = readingToFields(reading);
  return { ...f, notes: reading.notes, confidence: reading.confidence, lineCount: reading.lines.length };
}

export async function approveExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await approveExpense(tenantId, String(formData.get("expenseId") ?? ""), access.membershipId);
  refresh(tenantId);
}

export async function rejectExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  if (!access.membershipId) throw new Error("No staff account on this workspace.");

  await rejectExpense(tenantId, String(formData.get("expenseId") ?? ""), access.membershipId);
  refresh(tenantId);
}

/**
 * Split a payment: a real cost of running the business, or the owner taking
 * money out of it.
 *
 * Owner-level, because misclassifying drawings as costs is what makes a
 * profitable business look like it is barely surviving — and the person who
 * submitted the expense is rarely the person who knows which it was.
 */
export async function classifyExpenseAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await classifyExpense({
    tenantId,
    expenseId: String(formData.get("expenseId") ?? ""),
    isOwnerDrawing: formData.get("isOwnerDrawing") === "true",
  });

  refresh(tenantId);
}

export async function markDuplicateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  await markDuplicate(tenantId, String(formData.get("expenseId") ?? ""), String(formData.get("ofExpenseId") ?? ""));
  refresh(tenantId);
}

export async function keepBothAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");
  await keepBoth(tenantId, String(formData.get("expenseId") ?? ""));
  refresh(tenantId);
}
