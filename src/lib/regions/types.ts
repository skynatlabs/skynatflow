// What a country changes, and nothing else.
//
// The rule this file exists to enforce: no feature is written for a country.
// A feature is written once, universally, and a region pack supplies the few
// facts that differ — what the tax is called, how a date is written, what the
// company registry is, which couriers exist. A business in Ohio and a
// business in Benoni run the same code and see two different products.
//
// The test of whether something belongs here is simple. If removing a
// country's pack would remove a *feature*, the feature was built wrong: it
// should degrade to its universal form, not disappear. Tenders are the
// example worth keeping in mind — there is no South African tender module,
// there is a proposal system, and a South African government tender is one
// thing it produces.
//
// What a pack may hold: labels, rates, formats, validators, and lists of
// local providers. What a pack may never hold: business logic. The moment a
// pack needs a function that decides something, that decision belonged in the
// universal module with the pack supplying its inputs.

/** How the country writes 03/04/2026. Getting this wrong mis-dates history silently. */
export type DateOrder = "dmy" | "mdy" | "ymd";

/**
 * The shape of consumption tax, which decides far more than a rate.
 *
 * `vat` and `gst` are charged at the seller's rate and reclaimed on inputs —
 * one rate per item works. `sales-tax` is charged at the *buyer's* location
 * across thousands of jurisdictions and is never reclaimed, which the item
 * model here cannot express: a workspace on this regime is told so rather
 * than quietly given a wrong number.
 */
export type TaxKind = "vat" | "gst" | "sales-tax" | "none";

export interface TaxRegime {
  kind: TaxKind;
  /** What the business calls it. "VAT", "Sales tax", "GST". */
  label: string;
  /** The usual rate, where there is one. Null where it depends on the buyer. */
  standardRatePercent: number | null;
  /** Months per return period. 2 for South Africa's small vendors, 3 for quarterly, 1 for monthly. */
  periodMonths: number;
  /** What the return is called where it is filed. */
  returnName: string | null;
  authority: string | null;
  /** The registration threshold, in minor units of the country's currency. */
  registrationThreshold: number | null;
  /** Said on screen wherever a figure depends on it. */
  note: string;
}

export interface NumberFormatRule {
  /** What it is called on a form. "VAT number", "EIN", "ABN". */
  label: string;
  /** A short example, so somebody knows what shape to type. */
  example: string;
  /** Returns null when it looks right, or the reason it does not. */
  check: (raw: string) => string | null;
}

export interface ProviderRef {
  key: string;
  label: string;
  /** What it is for, in the words of somebody choosing. */
  what: string;
  /** What it would take to connect. Said plainly, never a Connect button that does nothing. */
  needs?: string;
}

/**
 * Feature keys a pack can switch on.
 *
 * Deliberately a small, closed list. Anything that is not here is universal
 * and available to every workspace — which is the default and should stay the
 * default. A key is added only when a feature is genuinely meaningless
 * elsewhere, and load-shedding is the clearest example there will ever be.
 */
export type RegionalFeature =
  | "power-schedule"
  | "company-registry-lookup"
  | "local-payroll"
  | "local-marketplaces"
  | "local-couriers";

export interface RegionPack {
  /** ISO 3166-1 alpha-2, or "*" for the universal fallback. */
  country: string;
  /** What a business here calls itself, for a heading. */
  label: string;
  currency: string;
  dateOrder: DateOrder;
  /** For Intl. Falls back sensibly where a runtime has never heard of it. */
  locale: string;
  /** The first day of the working week, 0 = Sunday. */
  weekStartsOn: number;
  /** When the tax year starts, as a month index. 2 = March, South Africa. */
  taxYearStartMonth: number;
  tax: TaxRegime;
  /** The numbers a business here is asked for. */
  businessNumbers: NumberFormatRule[];
  /** Local providers, by kind. Empty is a perfectly good answer. */
  providers: {
    couriers?: ProviderRef[];
    marketplaces?: ProviderRef[];
    payments?: ProviderRef[];
    payroll?: ProviderRef[];
    banks?: ProviderRef[];
  };
  /** Only what is genuinely meaningless elsewhere. */
  features: RegionalFeature[];
  /** The privacy law a business here answers to. */
  privacy: { law: string; regulator: string; subjectDays: number };
}
