"use server";

import { revalidatePath } from "next/cache";
import { ObligationKind, ObligationRecurrence, ObligationSeverity } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  addObligation,
  completeObligation,
  waiveObligation,
  rescheduleObligation,
} from "@/lib/core/obligations";
import { buildCalendarFromLibrary, adoptFromDocument } from "@/lib/core/obligationLibrary";
import { researchJurisdiction, readObligationFromDocument } from "@/lib/ai/jurisdiction";
import { prisma } from "@/lib/db";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // What the business owes a regulator, and deciding something no longer
  // applies, is an owner-level call — not something any signed-in staff
  // member should be able to quietly take off the list.
  assertCan(access, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/compliance`);
  revalidatePath(`/dashboard/${tenantId}`);
}

/**
 * Dates arrive from a date input as YYYY-MM-DD with no time.
 *
 * Pinned to midday UTC rather than midnight, so no timezone conversion
 * anywhere downstream can drag a deadline onto the previous day — which on
 * this screen is the difference between a warning and a deregistration.
 */
function parseDate(raw: FormDataEntryValue | null, label: string): Date {
  const text = String(raw ?? "").trim();
  const date = new Date(`${text}T12:00:00.000Z`);
  if (!text || Number.isNaN(date.getTime())) throw new Error(`${label} needs a valid date.`);
  return date;
}

export async function buildCalendarAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const on = (key: string) => formData.get(key) === "on";
  const monthRaw = Number(formData.get("registrationMonth"));
  const countryCode = String(formData.get("countryCode") ?? "").trim().toUpperCase();
  const regionCode = String(formData.get("regionCode") ?? "").trim().toUpperCase() || null;

  if (!countryCode) throw new Error("Tell us which country the business is registered in.");

  // Remembered on the workspace, not just used once: everything downstream —
  // research, document intake, which library rows apply — is keyed to it.
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { countryCode, regionCode },
  });

  const profile = {
    countryCode,
    regionCode,
    isCompany: on("isCompany"),
    isVatRegistered: on("isVatRegistered"),
    hasEmployees: on("hasEmployees"),
    hasVehicles: on("hasVehicles"),
    registrationMonth:
      Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null,
  };

  const result = await buildCalendarFromLibrary(tenantId, profile);

  // Nothing known about this place yet. Research it once, then try again —
  // the next business from the same country gets the answer instantly.
  if (result.jurisdictionEmpty) {
    await researchJurisdiction({ countryCode, regionCode });
    await buildCalendarFromLibrary(tenantId, profile);
  }

  refresh(tenantId);
}

export async function addObligationAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Give it a name.");

  const noticeRaw = Number(formData.get("noticeDays"));

  await addObligation({
    tenantId,
    kind: String(formData.get("kind") ?? "COMPLIANCE_FILING") as ObligationKind,
    title,
    dueAt: parseDate(formData.get("dueAt"), "Due date"),
    authority: String(formData.get("authority") ?? "").trim() || null,
    reference: String(formData.get("reference") ?? "").trim() || null,
    recurrence: String(formData.get("recurrence") ?? "NONE") as ObligationRecurrence,
    severity: String(formData.get("severity") ?? "MEDIUM") as ObligationSeverity,
    consequence: String(formData.get("consequence") ?? "").trim() || null,
    noticeDays: Number.isFinite(noticeRaw) && noticeRaw > 0 ? noticeRaw : null,
    blocksWork: formData.get("blocksWork") === "on",
  });

  refresh(tenantId);
}

export async function completeObligationAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await completeObligation({
    tenantId,
    obligationId: String(formData.get("obligationId") ?? ""),
  });

  refresh(tenantId);
}

export async function waiveObligationAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await waiveObligation({
    tenantId,
    obligationId: String(formData.get("obligationId") ?? ""),
    reason: String(formData.get("reason") ?? "").trim() || "Marked as not applicable.",
  });

  refresh(tenantId);
}

export async function rescheduleObligationAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await rescheduleObligation({
    tenantId,
    obligationId: String(formData.get("obligationId") ?? ""),
    dueAt: parseDate(formData.get("dueAt"), "Due date"),
  });

  refresh(tenantId);
}

export interface ReadDocumentResult {
  ok: boolean;
  message: string;
  title?: string;
  dueOn?: string;
  needsRealDate?: boolean;
  helpedOthers?: boolean;
}

/**
 * Read an obligation out of a document the business already has.
 *
 * Takes an object rather than FormData because the client component needs the
 * result back to show what was found — a plain form post would only be able
 * to say "something happened".
 *
 * Every failure path returns a message a person can act on. "No AI provider
 * configured" is the one that will actually happen most often on a fresh
 * install, and telling someone to type it in themselves is a better answer
 * than a spinner that never resolves.
 */
export async function readDocumentAction(input: {
  tenantId: string;
  text: string;
  fileName?: string | null;
}): Promise<ReadDocumentResult> {
  await guard(input.tenantId);

  const outcome = await readObligationFromDocument({
    text: input.text,
    fileName: input.fileName ?? null,
  });

  if (!outcome.ran || !outcome.reading) {
    return {
      ok: false,
      message:
        outcome.skipped === "no AI provider configured"
          ? "Reading documents needs an AI provider, and none is set up yet. Add it with the form alongside in the meantime — it takes a moment and works just as well."
          : "Couldn't make sense of that one. Paste a bit more of the wording, or add it with the form alongside.",
    };
  }

  const r = outcome.reading;
  if (!r.isObligation) {
    return {
      ok: false,
      message:
        "That looks like a document without a renewal or expiry — an invoice, a letter or similar. Nothing to track.",
    };
  }

  // The tenant's own country is the fallback when the document does not name
  // one, which is common on a locally-issued certificate: everyone who reads
  // it already knows where they are.
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { countryCode: true, regionCode: true },
  });

  const adopted = await adoptFromDocument({
    tenantId: input.tenantId,
    title: r.title,
    kind: r.kind,
    authority: r.authority,
    reference: r.reference,
    expiresOn: r.expiresOn ? new Date(`${r.expiresOn}T12:00:00.000Z`) : null,
    recurrence: r.recurrence,
    severity: r.severity,
    consequence: r.consequence,
    blocksWork: r.blocksWork,
    countryCode: r.countryCode ?? tenant?.countryCode ?? null,
    regionCode: r.regionCode ?? tenant?.regionCode ?? null,
  });

  refresh(input.tenantId);

  return {
    ok: true,
    message: `Added “${adopted.title}” to your calendar.`,
    title: adopted.title,
    dueOn: adopted.dueAt.toISOString().slice(0, 10),
    needsRealDate: adopted.needsRealDate,
    helpedOthers: adopted.contributedToLibrary,
  };
}
