"use server";

import { regionOf } from "@/lib/regions";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AgreementKind } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import {
  createAgreement,
  deleteDraftAgreement,
  parseClauses,
  sendAgreement,
  updateAgreement,
  type Clause,
} from "@/lib/core/agreements";
import { noteSigningEvent } from "@/lib/core/signing";
import { draftAgreement, kindFromDraft, withDisclaimer } from "@/lib/ai/agreement";
import { formatMoney } from "@/lib/format/money";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Writing what a customer is being offered is the same bar as quoting them.
  assertCan(access.role, "quote:create");
  return access;
}

function refresh(tenantId: string, id?: string) {
  revalidatePath(`/dashboard/${tenantId}/agreements`);
  if (id) revalidatePath(`/dashboard/${tenantId}/agreements/${id}`);
}

function date(value: FormDataEntryValue | null): Date | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cents(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").replace(/[^0-9.,-]/g, "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Headings and bodies arrive as parallel arrays, in the order they are shown. */
function clausesFrom(formData: FormData): Clause[] {
  const headings = formData.getAll("clauseHeading").map(String);
  const bodies = formData.getAll("clauseBody").map(String);
  const out: Clause[] = [];
  for (const [i, heading] of headings.entries()) {
    const body = (bodies[i] ?? "").trim();
    if (!heading.trim() && !body) continue;
    out.push({ heading: heading.trim() || "Clause", body });
  }
  return out;
}

export async function createAgreementAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const partyId = String(formData.get("partyId") ?? "").trim();
  if (!partyId) throw new Error("Pick who this is with.");

  const agreement = await createAgreement({
    tenantId,
    partyId,
    templateKey: String(formData.get("templateKey") ?? "").trim() || null,
    valueCents: cents(formData.get("value")),
    recurrence: String(formData.get("recurrence") ?? "").trim() || null,
    startsAt: date(formData.get("startsAt")),
    endsAt: date(formData.get("endsAt")),
    validUntil: date(formData.get("validUntil")),
    transactionId: String(formData.get("transactionId") ?? "").trim() || null,
    createdById: access.membershipId,
  });

  refresh(tenantId);
  redirect(`/dashboard/${tenantId}/agreements/${agreement.id}`);
}

/**
 * Draft it from a sentence.
 *
 * The model writes the words. The customer, the value and the dates are set
 * here, from the form, and handed to it only as context — a model that can
 * set the number on a contract is a model that will.
 */
export async function draftAgreementAction(tenantId: string, formData: FormData) {
  const access = await guard(tenantId);
  const partyId = String(formData.get("partyId") ?? "").trim();
  const instruction = String(formData.get("instruction") ?? "").trim();
  if (!partyId) throw new Error("Pick who this is with.");
  if (instruction.length < 10) throw new Error("Say a little more about what this agreement is for.");

  const [party, tenant] = await Promise.all([
    prisma.party.findFirst({ where: { id: partyId, tenantId } }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, currency: true, niche: true, countryCode: true } }),
  ]);
  if (!party) throw new Error("That customer is not in this workspace.");

  const valueCents = cents(formData.get("value"));
  const recurrence = String(formData.get("recurrence") ?? "").trim() || null;
  const startsAt = date(formData.get("startsAt"));
  const endsAt = date(formData.get("endsAt"));
  const region = await regionOf(tenantId);
  const asDate = (d: Date | null) => (d ? d.toLocaleDateString(region.locale, { day: "numeric", month: "long", year: "numeric" }) : undefined);

  const draft = await draftAgreement({
    instruction,
    business: tenant.name,
    customer: party.companyName ?? party.name,
    value:
      valueCents === null
        ? undefined
        : `${formatMoney(valueCents, tenant.currency, { decimals: true })}${
            recurrence === "monthly" ? " a month" : recurrence === "quarterly" ? " a quarter" : recurrence === "annually" ? " a year" : ""
          }`,
    starts: asDate(startsAt),
    ends: asDate(endsAt),
    niche: tenant.niche,
    country: tenant.countryCode ?? undefined,
  });

  // Nothing configured to draft with: fall back to the library rather than
  // leaving somebody at a blank page with an error.
  const agreement = await createAgreement({
    tenantId,
    partyId,
    templateKey: draft ? null : String(formData.get("templateKey") ?? "").trim() || "service",
    kind: draft ? kindFromDraft(draft.kind) : undefined,
    title: draft?.title,
    clauses: draft ? withDisclaimer(draft.clauses) : undefined,
    valueCents,
    recurrence,
    startsAt,
    endsAt,
    validUntil: date(formData.get("validUntil")),
    createdById: access.membershipId,
  });

  refresh(tenantId);
  redirect(`/dashboard/${tenantId}/agreements/${agreement.id}${draft ? "" : "?drafted=0"}`);
}

export async function saveAgreementAction(tenantId: string, id: string, formData: FormData) {
  await guard(tenantId);
  await updateAgreement(tenantId, id, {
    title: String(formData.get("title") ?? "").trim() || undefined,
    kind: (String(formData.get("kind") ?? "") as AgreementKind) || undefined,
    clauses: clausesFrom(formData),
    valueCents: cents(formData.get("value")),
    recurrence: String(formData.get("recurrence") ?? "").trim() || null,
    startsAt: date(formData.get("startsAt")),
    endsAt: date(formData.get("endsAt")),
    validUntil: date(formData.get("validUntil")),
    ourSignerName: String(formData.get("ourSignerName") ?? "").trim() || null,
  });
  refresh(tenantId, id);
}

export async function sendAgreementAction(tenantId: string, id: string) {
  const access = await guard(tenantId);
  await sendAgreement(tenantId, id);
  await noteSigningEvent({
    tenantId,
    kind: "agreement",
    documentId: id,
    event: "sent",
    actor: { type: "user", id: access.userId, name: "Somebody at the business" },
  });
  refresh(tenantId, id);
}

export async function deleteAgreementAction(tenantId: string, id: string) {
  await guard(tenantId);
  await deleteDraftAgreement(tenantId, id);
  revalidatePath(`/dashboard/${tenantId}/agreements`);
  redirect(`/dashboard/${tenantId}/agreements`);
}

/**
 * A new version of something already signed.
 *
 * The signed document is the record of what was agreed and must not change,
 * so "change it" means "copy it into a fresh draft" — which is what people
 * do with the Word file anyway, badly.
 */
export async function reviseAgreementAction(tenantId: string, id: string) {
  const access = await guard(tenantId);
  const existing = await prisma.agreement.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error("That agreement is not in this workspace.");

  const copy = await createAgreement({
    tenantId,
    partyId: existing.partyId,
    kind: existing.kind,
    title: `${existing.title.replace(/ \(revised.*\)$/, "")} (revised ${new Date().toLocaleDateString((await regionOf(tenantId)).locale)})`,
    clauses: parseClauses(existing.clauses),
    valueCents: existing.valueCents,
    recurrence: existing.recurrence,
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
    validUntil: existing.validUntil,
    transactionId: existing.transactionId,
    createdById: access.membershipId,
  });

  refresh(tenantId);
  redirect(`/dashboard/${tenantId}/agreements/${copy.id}`);
}
