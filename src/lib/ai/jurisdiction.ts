// Filling in a jurisdiction nobody has covered yet, and reading obligations
// out of the documents a business already has.
//
// These are the two ways the library grows without anyone at this company
// knowing what a business in Ohio or Kerala owes. Both write into the shared
// library, so the work is done once per country rather than once per user.
//
// Both degrade to nothing when no AI key is configured — the established
// pattern everywhere in this app. A workspace with no model still gets a
// working compliance calendar; it just has to type the first few rows itself,
// and those get offered onward exactly like a researched one would.

import { generateObject } from "ai";
import { z } from "zod";
import { getAiModel } from "./model";
import {
  contributeTemplate,
  jurisdictionStatus,
  markJurisdictionResearched,
} from "@/lib/core/obligationLibrary";

const KINDS = [
  "COMPLIANCE_FILING",
  "LICENCE",
  "CERTIFICATE",
  "TAX",
  "INSURANCE",
  "CONTRACT",
  "WARRANTY",
  "DOCUMENT",
] as const;

const RECURRENCES = [
  "NONE",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "BIANNUAL",
  "ANNUAL",
] as const;

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

const ObligationDraft = z.object({
  title: z
    .string()
    .describe("The name this filing or licence is actually known by in that country, in that country's own terminology."),
  authority: z.string().nullable().describe("The body that requires it."),
  kind: z.enum(KINDS),
  recurrence: z.enum(RECURRENCES),
  severity: z.enum(SEVERITIES),
  consequence: z
    .string()
    .describe("One or two plain sentences: what concretely happens to the business if this is missed."),
  dueMonth: z.number().int().min(1).max(12).nullable().describe("Month it falls due where there is a fixed national deadline, else null."),
  dueDay: z.number().int().min(1).max(31).nullable(),
  fromRegistrationAnniversary: z
    .boolean()
    .describe("True when the deadline follows the anniversary of the business's own registration rather than a fixed date."),
  requiresCompany: z.boolean().nullable().describe("True if only registered companies owe it, false if only unincorporated businesses, null if it makes no difference."),
  requiresVat: z.boolean().nullable(),
  requiresEmployees: z.boolean().nullable(),
  requiresVehicles: z.boolean().nullable(),
  blocksWork: z
    .boolean()
    .describe("True when carrying on working while this is lapsed is itself the serious risk, e.g. a licence to practise or mandatory liability cover."),
});

const ResearchResult = z.object({
  obligations: z.array(ObligationDraft),
  note: z
    .string()
    .nullable()
    .describe("Anything the business should know about how reliable this list is for their jurisdiction."),
});

export interface ResearchOutcome {
  ran: boolean;
  added: number;
  note: string | null;
  /** Why it didn't run, when it didn't. */
  skipped?: string;
}

/**
 * Research what a business in a given place owes, once per jurisdiction.
 *
 * Deliberately not run per signup. The second business from Gauteng should
 * get an instant calendar from what the first one's research produced, which
 * is the entire point of the library being shared.
 *
 * `minTemplates` guards the other direction: a jurisdiction with two rows in
 * it has not really been covered, so a thin library is worth topping up even
 * though something is there.
 */
export async function researchJurisdiction(params: {
  countryCode: string;
  regionCode?: string | null;
  /** Human-readable place name, to give the model something better than an ISO code. */
  placeName?: string | null;
  minTemplates?: number;
  force?: boolean;
}): Promise<ResearchOutcome> {
  const minTemplates = params.minTemplates ?? 5;
  const status = await jurisdictionStatus(params.countryCode, params.regionCode);

  if (!params.force && status.templateCount >= minTemplates) {
    return { ran: false, added: 0, note: status.note, skipped: "already covered" };
  }
  // Researched recently and still thin means the answer really is thin.
  // Re-asking every time a user visits would burn tokens to learn nothing.
  if (!params.force && status.researchedAt) {
    return { ran: false, added: 0, note: status.note, skipped: "already researched" };
  }

  const model = await getAiModel();
  if (!model) {
    return { ran: false, added: 0, note: null, skipped: "no AI provider configured" };
  }

  const place =
    params.placeName ??
    [params.regionCode, params.countryCode].filter(Boolean).join(", ");

  let result: z.infer<typeof ResearchResult>;
  try {
    const generated = await generateObject({
      model,
      schema: ResearchResult,
      prompt:
        `List the recurring legal and regulatory obligations a small or medium business in ` +
        `${place} has to meet to stay registered, licensed and in good standing.\n\n` +
        `Use the terminology businesses there actually use — the real name of the form, the ` +
        `filing or the certificate, and the real name of the authority. Do not translate them ` +
        `into another country's equivalents.\n\n` +
        `Cover: keeping the entity registered, taxes a business files itself, payroll-related ` +
        `filings, and any certificate or licence that customers or contracting parties commonly ` +
        `require. Leave out anything industry-specific.\n\n` +
        `For each one, the consequence field matters most: say concretely what happens to the ` +
        `business if it is missed, not that it is "important". Where a deadline depends on the ` +
        `business's own registration date rather than a fixed national date, set ` +
        `fromRegistrationAnniversary and leave the month and day null.\n\n` +
        `If you are not confident about this jurisdiction, return fewer obligations and say so ` +
        `in the note rather than guessing.`,
    });
    result = generated.object;
  } catch (err) {
    // A failed research pass is not an error the user should see: their
    // calendar still works, it is just empty until they add something.
    console.error(`[jurisdiction] research failed for ${place}:`, err);
    return { ran: false, added: 0, note: null, skipped: "research call failed" };
  }

  let added = 0;
  for (const o of result.obligations) {
    if (!o.title?.trim()) continue;
    await contributeTemplate({
      countryCode: params.countryCode,
      regionCode: params.regionCode ?? null,
      title: o.title,
      authority: o.authority,
      kind: o.kind,
      recurrence: o.recurrence,
      severity: o.severity,
      consequence: o.consequence,
      dueMonth: o.dueMonth,
      dueDay: o.dueDay,
      fromRegistrationAnniversary: o.fromRegistrationAnniversary,
      requiresCompany: o.requiresCompany,
      requiresVat: o.requiresVat,
      requiresEmployees: o.requiresEmployees,
      requiresVehicles: o.requiresVehicles,
      blocksWork: o.blocksWork,
      source: "RESEARCH",
      sourceNote: "Researched when the first business from this jurisdiction signed up.",
    });
    added++;
  }

  const finalStatus = await jurisdictionStatus(params.countryCode, params.regionCode);
  await markJurisdictionResearched({
    countryCode: params.countryCode,
    regionCode: params.regionCode,
    templateCount: finalStatus.templateCount,
    note: result.note,
  });

  return { ran: true, added, note: result.note };
}

// ------------------------------------------------------- document extraction

const DocumentReading = z.object({
  isObligation: z
    .boolean()
    .describe("False when the document is not something with a renewal, expiry or filing deadline at all."),
  title: z.string().describe("What this document is called, in the wording the document itself uses."),
  authority: z.string().nullable().describe("Who issued it."),
  reference: z.string().nullable().describe("Certificate, policy, licence or registration number, if one appears."),
  kind: z.enum(KINDS),
  expiresOn: z
    .string()
    .nullable()
    .describe("Expiry or next-renewal date as YYYY-MM-DD, only if the document actually states one."),
  recurrence: z.enum(RECURRENCES),
  severity: z.enum(SEVERITIES),
  consequence: z.string().nullable().describe("What happens to the business if this lapses."),
  blocksWork: z.boolean(),
  countryCode: z
    .string()
    .nullable()
    .describe("ISO 3166-1 alpha-2 code of the country that issued it, if determinable from the document."),
  regionCode: z.string().nullable().describe("State or province code, where the issuer is a regional one."),
});

export interface ExtractionOutcome {
  ran: boolean;
  reading: z.infer<typeof DocumentReading> | null;
  skipped?: string;
}

/**
 * Read an uploaded document and work out what obligation it represents.
 *
 * This is the path that makes the product work in a country nobody here has
 * heard of: a business uploads their trading licence, and the licence itself
 * tells us what it is called, who issues it and when it expires. No list we
 * could write would be as accurate as the document in their hand.
 *
 * Text only. Parsing a scanned PDF is a separate problem, and pretending to
 * have read one would be worse than saying we could not.
 */
export async function readObligationFromDocument(params: {
  text: string;
  fileName?: string | null;
}): Promise<ExtractionOutcome> {
  const text = params.text.trim();
  if (text.length < 40) {
    return { ran: false, reading: null, skipped: "not enough text to read" };
  }

  const model = await getAiModel();
  if (!model) return { ran: false, reading: null, skipped: "no AI provider configured" };

  try {
    const { object } = await generateObject({
      model,
      schema: DocumentReading,
      prompt:
        `Here is a business document${params.fileName ? ` named "${params.fileName}"` : ""}. ` +
        `Work out whether it represents something with a renewal, expiry or filing deadline — ` +
        `a licence, permit, certificate, registration, insurance policy or contract.\n\n` +
        `Name it exactly as the document names it, in its own country's terminology. Do not ` +
        `translate it into an equivalent from somewhere else, and do not invent a date the ` +
        `document does not state.\n\n` +
        `If it is an invoice, a quote, a bank statement, a letter or anything else without a ` +
        `renewal deadline, set isObligation to false and leave the rest minimal.\n\n` +
        `Document:\n${text.slice(0, 12_000)}`,
    });

    return { ran: true, reading: object };
  } catch (err) {
    console.error("[jurisdiction] document reading failed:", err);
    return { ran: false, reading: null, skipped: "reading failed" };
  }
}
