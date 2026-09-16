// Drafting a proposal or a contract from a sentence.
//
// The blank page is what stops these documents being written at all. The
// library in core/agreements.ts answers that for the common shapes; this
// answers it for "write me a maintenance contract for Ndlovu Trading, R4 500
// a month for a year, two site visits, four-hour response."
//
// The model writes prose into clauses and nothing else. It never sets a
// price, a date or a customer — those come from the caller, already checked,
// and are handed to it only as context to write around. A model that can
// invent the number on a contract is a model that will.
//
// No key configured means no drafting, and the caller falls back to the
// library. Same graceful degradation as every other AI step here.

import { generateObject } from "ai";
import { z } from "zod";
import { AgreementKind } from "@prisma/client";
import { getAiModel } from "./model";
import { AGREEMENT_TEMPLATES, NOT_LEGAL_ADVICE, type Clause } from "@/lib/core/agreements";

const DraftSchema = z.object({
  title: z.string().describe("The document's title, e.g. 'Maintenance agreement between Kagiso Plumbing and Ndlovu Trading'."),
  kind: z
    .enum(["PROPOSAL", "SERVICE", "RETAINER", "SUPPLY", "NDA", "SUBCONTRACT", "OTHER"])
    .describe("Which shape of document this is."),
  clauses: z
    .array(
      z.object({
        heading: z.string().describe("A short heading, in plain words. Not a clause number — numbering is added when it is printed."),
        body: z.string().describe("The clause itself. Plain language, complete sentences, no placeholders left in it."),
      })
    )
    .min(4)
    .max(16),
});

export type AgreementDraft = z.infer<typeof DraftSchema>;

export interface DraftRequest {
  /** What the owner typed. */
  instruction: string;
  business: string;
  customer: string;
  /** Already formatted, e.g. "R4 500,00 a month". The model must not invent one. */
  value?: string;
  starts?: string;
  ends?: string;
  /** The trade this business is in, so the wording knows what work looks like. */
  niche?: string;
  country?: string;
}

const SYSTEM =
  "You draft commercial agreements for a small business, in the plain language a working owner and their customer " +
  "can both read. Rules you never break:\n" +
  "- Use only the facts given. Never invent a price, a date, a name, a quantity or a term. Where a figure is " +
  "needed and none was given, write what it depends on rather than a number.\n" +
  "- Short sentences. No 'heretofore', no 'the party of the first part', no Latin.\n" +
  "- Each clause does one thing and says what actually happens, including what happens when it goes wrong.\n" +
  "- Never claim to be a lawyer, and never say the document has been reviewed by one.\n" +
  "- South African commercial context unless told otherwise: rand, VAT, 30-day terms, COIDA and the OHS Act where " +
  "people are on a site, mediation before court.\n" +
  "- No placeholders in square or curly brackets. Write the sentence, or leave the point out.";

export async function draftAgreement(req: DraftRequest): Promise<AgreementDraft | null> {
  const model = await getAiModel();
  if (!model) return null;

  const shapes = AGREEMENT_TEMPLATES.map((t) => `${t.kind}: ${t.label} — ${t.purpose}`).join("\n");

  const { object } = await generateObject({
    model,
    schema: DraftSchema,
    system: SYSTEM,
    prompt:
      `Business: ${req.business}${req.niche ? ` (${req.niche.toLowerCase()})` : ""}\n` +
      `Customer: ${req.customer}\n` +
      (req.value ? `Value: ${req.value}\n` : "") +
      (req.starts ? `Starts: ${req.starts}\n` : "") +
      (req.ends ? `Ends: ${req.ends}\n` : "") +
      (req.country ? `Country: ${req.country}\n` : "") +
      `\nThe shapes of document available:\n${shapes}\n\n` +
      `What the owner asked for:\n${req.instruction}\n\n` +
      `Draft it. Open with who the parties are and what is being done, and close with how disputes are handled and ` +
      `that this document is the whole agreement.`,
    maxRetries: 2,
  });

  return object;
}

/**
 * The drafted clauses, plus the line every generated document carries.
 *
 * It goes on as the last clause rather than a footnote, because a footnote is
 * where a disclaimer goes to be ignored.
 */
export function withDisclaimer(clauses: Clause[]): Clause[] {
  if (clauses.some((c) => c.body.includes("not legal advice"))) return clauses;
  return [...clauses, { heading: "Before you sign", body: NOT_LEGAL_ADVICE }];
}

export function kindFromDraft(kind: AgreementDraft["kind"]): AgreementKind {
  return AgreementKind[kind];
}
