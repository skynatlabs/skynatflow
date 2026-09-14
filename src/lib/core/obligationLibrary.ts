// The obligation library — what businesses in a given place owe, held as
// data rather than written into code.
//
// The rule this module exists to enforce: nothing in the compliance engine
// knows the name of a single statutory filing. "CIPC annual return" is a row
// keyed to ZA, "Franchise Tax Report" is a row keyed to US/TX, and both are
// reached by identical code. Adding the United States is adding rows, not
// editing a switch statement — and the rows can arrive from a document a
// business uploaded rather than from anyone at this company knowing what a
// Texas franchise tax is.
//
// The library is shared. One business in Ohio uploading their vendor's
// licence teaches the platform what that document is called in Ohio, and the
// next Ohio business is offered it. Provenance is kept for debugging and
// never shown across workspaces: what another business owes is not this
// business's information.

import { prisma } from "@/lib/db";
import {
  ObligationKind,
  ObligationRecurrence,
  ObligationSeverity,
  ObligationTemplateSource,
  type ObligationTemplate,
} from "@prisma/client";
import { addObligation, defaultLeadDays } from "./obligations";

/** What we know about the business, used to decide which templates apply. */
export interface BusinessProfile {
  countryCode: string;
  regionCode?: string | null;
  isCompany: boolean;
  isVatRegistered: boolean;
  hasEmployees: boolean;
  hasVehicles: boolean;
  /** Month of incorporation, 1-12, where the business knows it. */
  registrationMonth?: number | null;
}

/**
 * Does this template apply to this business?
 *
 * Null on a requirement means "this obligation does not care" — which is a
 * different answer from false, and conflating the two is how an employer
 * stops being shown the things that apply to everyone.
 */
function applies(t: ObligationTemplate, p: BusinessProfile): boolean {
  const check = (required: boolean | null, has: boolean) => required === null || required === has;
  return (
    check(t.requiresCompany, p.isCompany) &&
    check(t.requiresVat, p.isVatRegistered) &&
    check(t.requiresEmployees, p.hasEmployees) &&
    check(t.requiresVehicles, p.hasVehicles)
  );
}

/**
 * Templates for a place, most trusted first.
 *
 * Region rows and country-wide rows are both returned: a business in Texas
 * owes federal obligations as well as Texas ones, and a model that had to
 * choose between them would be wrong for every federal country.
 */
export async function templatesFor(profile: BusinessProfile): Promise<ObligationTemplate[]> {
  const rows = await prisma.obligationTemplate.findMany({
    where: {
      countryCode: profile.countryCode.toUpperCase(),
      OR: [
        { regionCode: null },
        ...(profile.regionCode ? [{ regionCode: profile.regionCode.toUpperCase() }] : []),
      ],
    },
  });

  return rows
    .filter((t) => applies(t, profile))
    // Something most businesses kept beats something most dismissed. Curated
    // rows sit above researched ones at equal evidence, because a researched
    // row is a good guess and a curated one was checked.
    .filter((t) => t.dismissedCount < 3 || t.adoptedCount >= t.dismissedCount)
    .sort((a, b) => {
      const trust = (t: ObligationTemplate) =>
        t.adoptedCount + t.confirmedCount * 2 - t.dismissedCount * 2 +
        (t.source === "CURATED" ? 5 : 0);
      return trust(b) - trust(a);
    });
}

// ------------------------------------------------------------------- dates

/**
 * The next time this template falls due for this business.
 *
 * Three cases, and the third is why this is not a one-liner: a fixed national
 * deadline, an anniversary of the business's own registration, and everything
 * else — a policy or permit whose date only the business knows, which gets a
 * placeholder a year out and a note saying so rather than a confident wrong
 * date.
 */
export function nextDueFor(
  t: ObligationTemplate,
  profile: BusinessProfile,
  now: Date = new Date()
): { dueAt: Date; needsRealDate: boolean } {
  if (t.fromRegistrationAnniversary && profile.registrationMonth) {
    return { dueAt: nextOccurrence(profile.registrationMonth, 1, now), needsRealDate: false };
  }
  if (t.dueMonth) {
    return { dueAt: nextOccurrence(t.dueMonth, t.dueDay ?? 28, now), needsRealDate: false };
  }
  // No date anyone but the business could know. A placeholder that admits it
  // is a placeholder beats a guess that looks authoritative.
  const placeholder = new Date(now.getTime());
  placeholder.setUTCFullYear(placeholder.getUTCFullYear() + 1);
  placeholder.setUTCHours(12, 0, 0, 0);
  return { dueAt: placeholder, needsRealDate: true };
}

function nextOccurrence(month: number, day: number, from: Date): Date {
  const year = from.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let candidate = new Date(Date.UTC(year, month - 1, Math.min(day, lastDay), 12, 0, 0));
  if (candidate.getTime() <= from.getTime()) {
    const nextLast = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
    candidate = new Date(Date.UTC(year + 1, month - 1, Math.min(day, nextLast), 12, 0, 0));
  }
  return candidate;
}

// ------------------------------------------------------------------ adopting

export interface BuildResult {
  created: number;
  skipped: number;
  /** Created with a placeholder date the business needs to correct. */
  needDates: number;
  /** True when the library has nothing for this place yet. */
  jurisdictionEmpty: boolean;
}

/**
 * Build a workspace's calendar from the library.
 *
 * Safe to run repeatedly: anything already on the list by title is skipped,
 * so answering a profile question later tops the calendar up rather than
 * duplicating it.
 */
export async function buildCalendarFromLibrary(
  tenantId: string,
  profile: BusinessProfile,
  now: Date = new Date()
): Promise<BuildResult> {
  const templates = await templatesFor(profile);
  if (templates.length === 0) {
    return { created: 0, skipped: 0, needDates: 0, jurisdictionEmpty: true };
  }

  const existing = await prisma.obligation.findMany({
    where: { tenantId },
    select: { title: true },
  });
  const have = new Set(existing.map((e) => e.title.toLowerCase()));

  let created = 0;
  let skipped = 0;
  let needDates = 0;

  for (const t of templates) {
    if (have.has(t.title.toLowerCase())) {
      skipped++;
      continue;
    }

    const { dueAt, needsRealDate } = nextDueFor(t, profile, now);

    await addObligation({
      tenantId,
      kind: t.kind,
      title: t.title,
      authority: t.authority,
      dueAt,
      recurrence: t.recurrence,
      severity: t.severity,
      leadDays: t.leadDays,
      consequence: t.consequence,
      noticeDays: t.noticeDays,
      blocksWork: t.blocksWork,
      templateId: t.id,
      notes: needsRealDate
        ? "We don't know your real date for this one — set it from your own paperwork."
        : null,
    });

    created++;
    if (needsRealDate) needDates++;
  }

  if (created > 0) {
    await prisma.obligationTemplate.updateMany({
      where: { id: { in: templates.map((t) => t.id) } },
      data: { adoptedCount: { increment: 1 } },
    });
  }

  return { created, skipped, needDates, jurisdictionEmpty: false };
}

// -------------------------------------------------------------- contributing

export interface ContributionInput {
  countryCode: string;
  regionCode?: string | null;
  title: string;
  kind: ObligationKind;
  authority?: string | null;
  recurrence?: ObligationRecurrence;
  severity?: ObligationSeverity;
  consequence?: string | null;
  leadDays?: number;
  noticeDays?: number | null;
  blocksWork?: boolean;
  dueMonth?: number | null;
  dueDay?: number | null;
  fromRegistrationAnniversary?: boolean;
  requiresCompany?: boolean | null;
  requiresVat?: boolean | null;
  requiresEmployees?: boolean | null;
  requiresVehicles?: boolean | null;
  source: ObligationTemplateSource;
  sourceNote?: string | null;
  contributedByTenantId?: string | null;
}

/**
 * Offer something back to the library.
 *
 * Upsert on (country, region, title): two businesses in the same place
 * uploading the same licence should strengthen one row rather than create a
 * second. A repeat sighting raises confirmedCount, which is the only evidence
 * we have that a template is real rather than one business's typo.
 */
export async function contributeTemplate(input: ContributionInput): Promise<ObligationTemplate> {
  const countryCode = input.countryCode.toUpperCase();
  const regionCode = input.regionCode?.toUpperCase() ?? null;
  const title = input.title.trim();

  const existing = await prisma.obligationTemplate.findFirst({
    where: { countryCode, regionCode, title: { equals: title, mode: "insensitive" } },
  });

  if (existing) {
    return prisma.obligationTemplate.update({
      where: { id: existing.id },
      data: {
        confirmedCount: { increment: 1 },
        // Fill gaps a later, better-informed sighting can close; never
        // overwrite something already known, because the first contributor
        // may have been more careful than the second.
        consequence: existing.consequence ?? input.consequence ?? null,
        authority: existing.authority ?? input.authority ?? null,
        dueMonth: existing.dueMonth ?? input.dueMonth ?? null,
        dueDay: existing.dueDay ?? input.dueDay ?? null,
      },
    });
  }

  return prisma.obligationTemplate.create({
    data: {
      countryCode,
      regionCode,
      title,
      kind: input.kind,
      authority: input.authority ?? null,
      recurrence: input.recurrence ?? ObligationRecurrence.ANNUAL,
      severity: input.severity ?? ObligationSeverity.MEDIUM,
      leadDays: input.leadDays ?? defaultLeadDays(input.kind, input.severity),
      consequence: input.consequence ?? null,
      noticeDays: input.noticeDays ?? null,
      blocksWork: input.blocksWork ?? false,
      dueMonth: input.dueMonth ?? null,
      dueDay: input.dueDay ?? null,
      fromRegistrationAnniversary: input.fromRegistrationAnniversary ?? false,
      requiresCompany: input.requiresCompany ?? null,
      requiresVat: input.requiresVat ?? null,
      requiresEmployees: input.requiresEmployees ?? null,
      requiresVehicles: input.requiresVehicles ?? null,
      source: input.source,
      sourceNote: input.sourceNote ?? null,
      contributedByTenantId: input.contributedByTenantId ?? null,
    },
  });
}

/** A business saying "this one doesn't apply to me" is evidence about the template. */
export async function recordDismissal(templateId: string): Promise<void> {
  await prisma.obligationTemplate.update({
    where: { id: templateId },
    data: { dismissedCount: { increment: 1 } },
  });
}

// ------------------------------------------------------------------ coverage

export interface JurisdictionStatus {
  countryCode: string;
  regionCode: string | null;
  templateCount: number;
  researchedAt: Date | null;
  note: string | null;
}

export async function jurisdictionStatus(
  countryCode: string,
  regionCode?: string | null
): Promise<JurisdictionStatus> {
  const country = countryCode.toUpperCase();
  const region = regionCode?.toUpperCase() ?? null;

  const [coverage, count] = await Promise.all([
    prisma.jurisdictionCoverage.findFirst({
      where: { countryCode: country, regionCode: region },
    }),
    prisma.obligationTemplate.count({
      where: {
        countryCode: country,
        OR: [{ regionCode: null }, ...(region ? [{ regionCode: region }] : [])],
      },
    }),
  ]);

  return {
    countryCode: country,
    regionCode: region,
    templateCount: count,
    researchedAt: coverage?.researchedAt ?? null,
    note: coverage?.note ?? null,
  };
}

export async function markJurisdictionResearched(params: {
  countryCode: string;
  regionCode?: string | null;
  templateCount: number;
  note?: string | null;
}): Promise<void> {
  const countryCode = params.countryCode.toUpperCase();
  const regionCode = params.regionCode?.toUpperCase() ?? null;

  // Not an upsert: `regionCode` is nullable, and Prisma will not accept null
  // inside a compound unique `where`, so a country-wide row cannot be
  // addressed that way. Find-then-write is the same thing spelled out.
  const existing = await prisma.jurisdictionCoverage.findFirst({
    where: { countryCode, regionCode },
    select: { id: true },
  });

  const data = {
    templateCount: params.templateCount,
    researchedAt: new Date(),
    note: params.note ?? null,
  };

  if (existing) {
    await prisma.jurisdictionCoverage.update({ where: { id: existing.id }, data });
  } else {
    await prisma.jurisdictionCoverage.create({ data: { countryCode, regionCode, ...data } });
  }
}

// ------------------------------------------------------------------- intake

export interface AdoptedDocument {
  obligationId: string;
  title: string;
  dueAt: Date;
  /** True when the document did not state a date and one has to be supplied. */
  needsRealDate: boolean;
  /** True when this also taught the library something new about the jurisdiction. */
  contributedToLibrary: boolean;
}

/**
 * Turn something read out of a business's own document into a live obligation,
 * and offer what it taught us back to the library.
 *
 * This is the path that makes the platform work somewhere nobody here has
 * heard of. A trading licence from a municipality in a country we have never
 * seen names itself, names its issuer and states its expiry — which is more
 * reliable than any list we could have written in advance, and good enough to
 * offer to the next business from that municipality.
 *
 * The contribution is deliberately narrow: only when the document told us
 * which country it came from. A template filed under the wrong jurisdiction is
 * worse than no template, because it propagates.
 */
export async function adoptFromDocument(params: {
  tenantId: string;
  title: string;
  kind: ObligationKind;
  authority?: string | null;
  reference?: string | null;
  expiresOn?: Date | null;
  recurrence?: ObligationRecurrence;
  severity?: ObligationSeverity;
  consequence?: string | null;
  blocksWork?: boolean;
  documentDataUrl?: string | null;
  /** Where the document says it came from. Null means do not touch the library. */
  countryCode?: string | null;
  regionCode?: string | null;
}): Promise<AdoptedDocument> {
  const needsRealDate = !params.expiresOn;
  // A document with no stated expiry still deserves a place on the calendar —
  // with a date the business has to confirm, and a note saying why.
  const dueAt =
    params.expiresOn ??
    (() => {
      const d = new Date();
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      d.setUTCHours(12, 0, 0, 0);
      return d;
    })();

  let contributedToLibrary = false;
  let templateId: string | null = null;

  if (params.countryCode) {
    const template = await contributeTemplate({
      countryCode: params.countryCode,
      regionCode: params.regionCode ?? null,
      title: params.title,
      kind: params.kind,
      authority: params.authority ?? null,
      recurrence: params.recurrence ?? ObligationRecurrence.ANNUAL,
      severity: params.severity ?? ObligationSeverity.MEDIUM,
      consequence: params.consequence ?? null,
      blocksWork: params.blocksWork ?? false,
      // The expiry on one business's certificate is that business's date, not
      // the jurisdiction's deadline, so it is deliberately not written to the
      // template as a national due date.
      dueMonth: null,
      dueDay: null,
      source: ObligationTemplateSource.DOCUMENT,
      sourceNote: "Learned from a document a business uploaded.",
      contributedByTenantId: params.tenantId,
    });
    templateId = template.id;
    contributedToLibrary = true;
  }

  const obligation = await addObligation({
    tenantId: params.tenantId,
    kind: params.kind,
    title: params.title,
    authority: params.authority ?? null,
    reference: params.reference ?? null,
    dueAt,
    recurrence: params.recurrence ?? ObligationRecurrence.ANNUAL,
    severity: params.severity ?? ObligationSeverity.MEDIUM,
    consequence: params.consequence ?? null,
    blocksWork: params.blocksWork ?? false,
    templateId,
    notes: needsRealDate
      ? "The document didn't state an expiry date — set the real one from your paperwork."
      : null,
  });

  if (params.documentDataUrl) {
    await prisma.obligation.update({
      where: { id: obligation.id },
      data: { documentDataUrl: params.documentDataUrl },
    });
  }

  return {
    obligationId: obligation.id,
    title: obligation.title,
    dueAt: obligation.dueAt,
    needsRealDate,
    contributedToLibrary,
  };
}
