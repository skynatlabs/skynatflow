// Turning a stranger into a customer.
//
// The gap this closes is embarrassingly simple and worth a great deal: a
// person fills in a form on a website, it goes to an email address somebody
// checks twice a day, and the job goes to whoever answered first. Speed is
// most of why one business wins work and the one down the road does not.
//
// So: a form with a public address, an answer that goes back the second it is
// submitted, and a customer record created immediately rather than after
// somebody has read the email. The submission is still a person's to act on —
// nothing here quotes anybody — but the lead exists, is on the timeline, and
// is somebody's before anyone has opened a laptop.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createParty, findPartyByPhone } from "./parties";
import { createNotification } from "./notifications2";
import { setConsent } from "./consent";

export type FieldType = "text" | "email" | "phone" | "long" | "choice";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** For a choice field. */
  options?: string[];
}

/** The questions almost every small business actually needs. */
export const DEFAULT_FIELDS: FormField[] = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "phone", label: "Phone number", type: "phone", required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "need", label: "What do you need?", type: "long", required: true },
];

function parseFields(raw: Prisma.JsonValue | null | undefined): FormField[] {
  if (!Array.isArray(raw)) return DEFAULT_FIELDS;
  const out: FormField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const f = entry as Record<string, unknown>;
    if (typeof f.name !== "string" || typeof f.label !== "string") continue;
    out.push({
      name: f.name,
      label: f.label,
      type: (typeof f.type === "string" ? f.type : "text") as FieldType,
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? (f.options.filter((o) => typeof o === "string") as string[]) : undefined,
    });
  }
  return out.length > 0 ? out : DEFAULT_FIELDS;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function createLeadForm(params: {
  tenantId: string;
  title: string;
  slug?: string;
  intro?: string | null;
  fields?: FormField[];
  autoReply?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("The form needs a title.");
  const slug = slugify(params.slug || title) || "enquiry";

  return prisma.leadForm.upsert({
    where: { tenantId_slug: { tenantId: params.tenantId, slug } },
    create: {
      tenantId: params.tenantId,
      slug,
      title,
      intro: params.intro?.trim() || null,
      fields: (params.fields ?? DEFAULT_FIELDS) as unknown as Prisma.InputJsonValue,
      autoReply: params.autoReply?.trim() || null,
    },
    update: {
      title,
      intro: params.intro?.trim() || null,
      fields: (params.fields ?? DEFAULT_FIELDS) as unknown as Prisma.InputJsonValue,
      autoReply: params.autoReply?.trim() || undefined,
      isActive: true,
    },
  });
}

export async function setFormActive(tenantId: string, formId: string, isActive: boolean) {
  const form = await prisma.leadForm.findFirst({ where: { id: formId, tenantId }, select: { id: true } });
  if (!form) throw new Error("That form is not in this workspace.");
  return prisma.leadForm.update({ where: { id: formId }, data: { isActive } });
}

export async function listLeadForms(tenantId: string) {
  const forms = await prisma.leadForm.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { submissions: { select: { id: true, handledAt: true } } },
  });
  return forms.map((f) => ({
    ...f,
    fieldList: parseFields(f.fields),
    total: f.submissions.length,
    unhandled: f.submissions.filter((s) => !s.handledAt).length,
  }));
}

/** The form as a stranger sees it. No tenant id in, no tenant id out. */
export async function publicForm(tenantId: string, slug: string) {
  const form = await prisma.leadForm.findFirst({
    where: { tenantId, slug, isActive: true },
    select: { id: true, title: true, intro: true, fields: true },
  });
  if (!form) return null;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  return { id: form.id, title: form.title, intro: form.intro, fields: parseFields(form.fields), businessName: tenant.name };
}

export interface SubmitResult {
  submissionId: string;
  partyId: string | null;
  /** What to show the person who just filled it in. */
  reply: string;
}

/**
 * Somebody filled it in.
 *
 * A customer record is created straight away where there is enough to make
 * one, because a lead that only exists as a row in a submissions table is a
 * lead nobody chases. Filling in a form is also consent to be replied to on
 * whatever they gave — recorded, so the reply is defensible.
 */
export async function submitLeadForm(params: {
  tenantId: string;
  slug: string;
  answers: Record<string, string>;
  source?: "web" | "qr" | "widget";
}): Promise<SubmitResult> {
  const form = await prisma.leadForm.findFirst({
    where: { tenantId: params.tenantId, slug: params.slug, isActive: true },
  });
  if (!form) throw new Error("That form is not taking answers.");

  const fields = parseFields(form.fields);
  for (const field of fields) {
    if (field.required && !params.answers[field.name]?.trim()) throw new Error(`${field.label} is needed.`);
  }

  const name = params.answers.name?.trim();
  const phone = params.answers.phone?.trim();
  const email = params.answers.email?.trim();

  let partyId: string | null = null;
  if (name || phone || email) {
    // Somebody who has enquired before is the same person, not a second one.
    // By number first, because a number is what somebody always gives and an
    // address is what they sometimes do.
    const existing =
      (phone ? await findPartyByPhone(params.tenantId, phone) : null) ??
      (email
        ? await prisma.party.findFirst({
            where: { tenantId: params.tenantId, email: { equals: email, mode: "insensitive" } },
            select: { id: true },
          })
        : null);
    partyId = existing
      ? existing.id
      : (
          await createParty({
            tenantId: params.tenantId,
            name: name || email || phone || "Enquiry",
            role: "CUSTOMER",
            phone: phone || undefined,
            email: email || undefined,
            notes: params.answers.need?.slice(0, 500),
          })
        ).id;

    // They handed over the address and asked to be contacted on it.
    for (const [channel, value] of [["email", email], ["whatsapp", phone], ["sms", phone]] as const) {
      if (value) {
        await setConsent({
          tenantId: params.tenantId,
          partyId,
          channel,
          state: "granted",
          source: `Filled in "${form.title}"`,
        }).catch(() => {});
      }
    }
  }

  const submission = await prisma.leadSubmission.create({
    data: {
      tenantId: params.tenantId,
      formId: form.id,
      answers: params.answers as unknown as Prisma.InputJsonValue,
      partyId,
      source: params.source ?? "web",
    },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true } });
  await createNotification({
    tenantId: params.tenantId,
    type: "HOT_LEAD",
    title: `New enquiry from ${name || phone || email || "someone"}`,
    body: params.answers.need?.slice(0, 200) ?? form.title,
    linkHref: `/dashboard/${params.tenantId}/inbox`,
  });

  return {
    submissionId: submission.id,
    partyId,
    reply:
      form.autoReply?.trim() ||
      `Thank you — ${tenant.name} has your details and will come back to you shortly.`,
  };
}

export async function listSubmissions(tenantId: string, opts: { handled?: boolean; formId?: string } = {}) {
  const rows = await prisma.leadSubmission.findMany({
    where: {
      tenantId,
      ...(opts.formId ? { formId: opts.formId } : {}),
      ...(opts.handled === undefined ? {} : opts.handled ? { handledAt: { not: null } } : { handledAt: null }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { form: { select: { title: true } }, party: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ ...r, answerList: r.answers as Record<string, string> }));
}

export async function markLeadHandled(tenantId: string, submissionId: string) {
  const submission = await prisma.leadSubmission.findFirst({ where: { id: submissionId, tenantId }, select: { id: true } });
  if (!submission) throw new Error("That enquiry is not in this workspace.");
  return prisma.leadSubmission.update({ where: { id: submissionId }, data: { handledAt: new Date() } });
}

/** How fast enquiries are answered — the number that decides how many convert. */
export async function leadResponseHealth(tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.leadSubmission.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: { createdAt: true, handledAt: true },
  });
  if (rows.length === 0) return { enquiries: 0, unanswered: 0, medianHours: null, summary: "No enquiries in this period." };

  const gaps = rows
    .filter((r) => r.handledAt)
    .map((r) => (r.handledAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  const median = gaps.length === 0 ? null : Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10;
  const unanswered = rows.filter((r) => !r.handledAt).length;

  return {
    enquiries: rows.length,
    unanswered,
    medianHours: median,
    summary:
      `${rows.length} ${rows.length === 1 ? "enquiry" : "enquiries"} in ${days} days` +
      (median !== null ? `, usually answered in ${median} hours` : "") +
      (unanswered > 0 ? `, and ${unanswered} never answered at all.` : "."),
  };
}
