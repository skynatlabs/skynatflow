// Curated starting rows for the obligation library.
//
// These are ordinary library rows, not special ones. They exist because South
// Africa is the first market and the United States is the second, so shipping
// with those two covered beats making the first user of each wait on a
// research pass. Every row here could equally have arrived from a document
// somebody uploaded — that is the whole design, and the reason this file is
// data with no logic in it.
//
// Nothing else in the codebase imports this. It is applied once at startup or
// from a script, and after that the library is just a table. Deleting this
// file would cost two markets a head start and break nothing.
//
// The deadlines are the standard statutory ones and every one is editable by
// the business that adopts it. Where a date depends on the business rather
// than the state — an incorporation anniversary, a policy renewal — the row
// says so instead of inventing one.

import { prisma } from "@/lib/db";
import { contributeTemplate, type ContributionInput } from "./obligationLibrary";

type Seed = Omit<ContributionInput, "source"> & { source?: ContributionInput["source"] };

// ---------------------------------------------------------------- ZA

const ZA: Seed[] = [
  {
    countryCode: "ZA",
    title: "CIPC annual return",
    authority: "CIPC",
    kind: "COMPLIANCE_FILING",
    recurrence: "ANNUAL",
    severity: "CRITICAL",
    leadDays: 45,
    fromRegistrationAnniversary: true,
    requiresCompany: true,
    consequence:
      "Miss it for long enough and CIPC deregisters the company: the bank account is frozen, " +
      "contracts in the company's name fall away, and the directors can be held personally " +
      "liable for what the business does after that. Reinstatement is slow and expensive.",
  },
  {
    countryCode: "ZA",
    title: "VAT201 return and payment",
    authority: "SARS",
    kind: "TAX",
    recurrence: "BIMONTHLY",
    severity: "HIGH",
    leadDays: 10,
    dueMonth: null,
    dueDay: 25,
    requiresVat: true,
    consequence:
      "SARS charges a 10% late-payment penalty plus interest, and a pattern of late returns " +
      "costs you your tax compliance status — which is what tenders and big customers check.",
  },
  {
    countryCode: "ZA",
    title: "EMP201 — PAYE, UIF and SDL",
    authority: "SARS",
    kind: "TAX",
    recurrence: "MONTHLY",
    severity: "HIGH",
    leadDays: 5,
    dueDay: 7,
    requiresEmployees: true,
    consequence:
      "Due by the 7th of the following month. Late payment carries a 10% penalty plus interest, " +
      "and PAYE deducted from staff and not paid over is treated far more seriously than an " +
      "ordinary tax debt.",
  },
  {
    countryCode: "ZA",
    title: "COIDA Return of Earnings",
    authority: "Department of Employment and Labour",
    kind: "COMPLIANCE_FILING",
    recurrence: "ANNUAL",
    severity: "HIGH",
    leadDays: 45,
    dueMonth: 5,
    dueDay: 31,
    requiresEmployees: true,
    consequence:
      "No return means no Letter of Good Standing, and without one you are locked out of most " +
      "tenders and refused entry to many sites — usually discovered the week the work was meant " +
      "to start.",
  },
  {
    countryCode: "ZA",
    title: "Letter of Good Standing",
    authority: "Department of Employment and Labour",
    kind: "CERTIFICATE",
    recurrence: "ANNUAL",
    severity: "HIGH",
    dueMonth: 6,
    dueDay: 30,
    requiresEmployees: true,
    consequence:
      "Expires annually. Main contractors and tender desks ask for a current one, and a stale " +
      "letter is the same as no letter.",
  },
  {
    countryCode: "ZA",
    title: "IRP6 provisional tax — second period",
    authority: "SARS",
    kind: "TAX",
    recurrence: "ANNUAL",
    severity: "MEDIUM",
    leadDays: 21,
    dueMonth: 2,
    dueDay: 28,
    consequence:
      "The second payment is the one that matters — an underestimate here attracts an " +
      "underestimation penalty on top of the interest.",
  },
  {
    countryCode: "ZA",
    title: "Tax compliance status (tax clearance)",
    authority: "SARS",
    kind: "CERTIFICATE",
    recurrence: "ANNUAL",
    severity: "HIGH",
    consequence:
      "Customers and tender desks verify this with a PIN. It goes non-compliant the moment a " +
      "return or payment is outstanding, and you usually find out from the customer.",
  },
  {
    countryCode: "ZA",
    title: "B-BBEE affidavit or certificate",
    authority: "Accredited agency or commissioner of oaths",
    kind: "CERTIFICATE",
    recurrence: "ANNUAL",
    severity: "HIGH",
    consequence:
      "Valid for twelve months. An expired affidavit scores your customer zero on procurement, " +
      "which is why they stop buying from you rather than telling you about it.",
  },
];

// ---------------------------------------------------------------- US

const US: Seed[] = [
  {
    countryCode: "US",
    title: "Federal income tax return",
    authority: "IRS",
    kind: "TAX",
    recurrence: "ANNUAL",
    severity: "HIGH",
    leadDays: 45,
    dueMonth: 4,
    dueDay: 15,
    consequence:
      "Failure-to-file penalties accrue monthly and are steeper than failure-to-pay penalties, " +
      "so filing on time matters even in a year you cannot pay in full.",
  },
  {
    countryCode: "US",
    title: "Estimated tax payment (Form 1040-ES)",
    authority: "IRS",
    kind: "TAX",
    recurrence: "QUARTERLY",
    severity: "MEDIUM",
    leadDays: 14,
    dueDay: 15,
    consequence: "Underpaying across the year attracts an underpayment penalty even if the final return is correct.",
  },
  {
    countryCode: "US",
    title: "Form 941 — quarterly payroll tax return",
    authority: "IRS",
    kind: "TAX",
    recurrence: "QUARTERLY",
    severity: "HIGH",
    leadDays: 14,
    requiresEmployees: true,
    consequence:
      "Payroll tax withheld from staff and not paid over is treated far more seriously than an " +
      "ordinary tax debt, and the liability can follow the responsible person personally.",
  },
  {
    countryCode: "US",
    title: "Form 940 — federal unemployment (FUTA)",
    authority: "IRS",
    kind: "TAX",
    recurrence: "ANNUAL",
    severity: "MEDIUM",
    leadDays: 21,
    dueMonth: 1,
    dueDay: 31,
    requiresEmployees: true,
    consequence: "Late filing attracts penalties and interest on the unpaid balance.",
  },
  {
    countryCode: "US",
    title: "W-2 and 1099-NEC filing",
    authority: "IRS / SSA",
    kind: "COMPLIANCE_FILING",
    recurrence: "ANNUAL",
    severity: "HIGH",
    leadDays: 30,
    dueMonth: 1,
    dueDay: 31,
    requiresEmployees: true,
    consequence:
      "Per-form penalties apply for each late or missing information return, and they scale with " +
      "how late they are.",
  },
  {
    countryCode: "US",
    title: "State annual report / franchise tax",
    authority: "Secretary of State",
    kind: "COMPLIANCE_FILING",
    recurrence: "ANNUAL",
    severity: "CRITICAL",
    leadDays: 45,
    requiresCompany: true,
    consequence:
      "Missing it puts the entity out of good standing, and eventually leads to administrative " +
      "dissolution — at which point the liability shield is gone and the business is trading as " +
      "something other than what its contracts say it is.",
    sourceNote:
      "The deadline and the fee differ by state. Set your real date from your own filing notice.",
  },
  {
    countryCode: "US",
    title: "Registered agent renewal",
    authority: "Registered agent",
    kind: "COMPLIANCE_FILING",
    recurrence: "ANNUAL",
    severity: "HIGH",
    requiresCompany: true,
    consequence:
      "Without a registered agent on file the state cannot serve you, which is how businesses " +
      "lose lawsuits they never knew had been filed.",
  },
];

// Insurance applies everywhere and belongs to no tax authority, so it is
// listed per country rather than pretended to be universal — the consequence
// wording is genuinely different where cover is legally mandated.
const UNIVERSAL_PER_COUNTRY: Seed[] = ["ZA", "US"].map((countryCode) => ({
  countryCode,
  title: "Business insurance renewal",
  authority: "Insurer",
  kind: "INSURANCE" as const,
  recurrence: "ANNUAL" as const,
  severity: "HIGH" as const,
  blocksWork: true,
  consequence:
    "Liability cover lapsing is not an admin problem — most sites and many customers require " +
    "cover to be current before work starts, and a claim during a lapse is yours.",
}));

export const CURATED_SEEDS: Seed[] = [...ZA, ...US, ...UNIVERSAL_PER_COUNTRY];

export interface SeedLibraryResult {
  inserted: number;
  alreadyPresent: number;
  countries: string[];
}

/**
 * Load the curated rows into the library.
 *
 * Idempotent through contributeTemplate's upsert-on-title, so running it
 * again after a deploy strengthens the existing rows rather than duplicating
 * them.
 */
export async function seedCuratedLibrary(): Promise<SeedLibraryResult> {
  const before = await prisma.obligationTemplate.count();

  for (const seed of CURATED_SEEDS) {
    await contributeTemplate({ ...seed, source: seed.source ?? "CURATED" });
  }

  const after = await prisma.obligationTemplate.count();
  return {
    inserted: after - before,
    alreadyPresent: CURATED_SEEDS.length - (after - before),
    countries: [...new Set(CURATED_SEEDS.map((s) => s.countryCode))],
  };
}
