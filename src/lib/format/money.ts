// Money, written down — the pure half, safe to import from client components.
//
// Kept apart from the database lookup in lib/core/currency.ts so a client
// component formatting a figure does not pull the Postgres driver into the
// browser bundle, which is what importing the combined module did.
//
// Money, written down.
//
// Every figure the officers say out loud goes through here, and this is the
// only place that knows what a currency looks like. The workspace carries its
// currency (Tenant.currency, ISO 4217); nothing downstream may assume rands.
// A formatter that hardcodes "R" is a geo-lock wearing a different hat.
//
// That warning used to sit here above a signature reading `currency = "ZAR"`,
// and sixty-one call sites took the default. The lesson is not that people
// should read comments: it is that a forgiving default makes the mistake
// invisible, and the fix is to make the compiler ask. `currency` is required
// now, so a figure whose owner nobody thought about will not build.

// The locale that writes a currency the way its own speakers expect — rands
// with a space and a comma, dollars with a comma and a point. Falls back to
// en-US, which every runtime has, for anything not listed.
const LOCALE_FOR: Record<string, string> = {
  ZAR: "en-ZA",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "de-DE",
  AUD: "en-AU",
  NZD: "en-NZ",
  CAD: "en-CA",
  INR: "en-IN",
  NGN: "en-NG",
  KES: "en-KE",
  GHS: "en-GH",
  BWP: "en-BW",
  NAD: "en-NA",
  ZMW: "en-ZM",
  MZN: "pt-MZ",
  AED: "en-AE",
  SGD: "en-SG",
};

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, decimals: boolean): Intl.NumberFormat {
  const key = `${currency}:${decimals ? 2 : 0}`;
  let f = formatters.get(key);
  if (!f) {
    const locale = LOCALE_FOR[currency] ?? "en-US";
    try {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: decimals ? 2 : 0,
      });
    } catch {
      // An unrecognised code is still somebody's money. Write the code, not
      // an exception.
      f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: decimals ? 2 : 0,
      });
      const fallback = f;
      f = {
        format: (n: number) => `${currency} ${fallback.format(n).replace(/^[^\d-]+/, "")}`,
      } as Intl.NumberFormat;
    }
    formatters.set(key, f);
  }
  return f;
}

/**
 * Cents to a sentence-ready amount: R45 000, $45,000, €45.000.
 *
 * Whole units by default because that is how money is spoken about — "R45
 * 000 is overdue" — and the cents are on the document for anyone who needs
 * them. Negative amounts keep their sign; the caller decides whether a loss
 * reads better as "-R4 000" or "R4 000 down".
 */
export function formatMoney(
  cents: number,
  currency: string,
  opts: { decimals?: boolean } = {}
): string {
  // Intl writes "R 45 000"; every document this app has ever produced writes
  // "R45 000", and a figure that changes shape between the invoice and the
  // officer's sentence reads as two different numbers. Close the gap between
  // a leading symbol and its digits; a trailing symbol keeps its locale's space.
  return formatter(currency, opts.decimals ?? false)
    .format(cents / 100)
    .replace(/^(-?)(?![A-Z]{3}\s)([^\d\s-]+)\s+(?=\d)/, "$1$2");
}

/** The bare symbol, for a field label: "Amount (R)". */
export function currencySymbol(currency: string): string {
  const parts = formatter(currency, false).formatToParts(1);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}

/** ISO 4217 codes worth offering at signup, keyed by country. Not a limit. */
export const CURRENCY_FOR_COUNTRY: Record<string, string> = {
  ZA: "ZAR",
  US: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  ES: "EUR",
  IT: "EUR",
  PT: "EUR",
  AU: "AUD",
  NZ: "NZD",
  CA: "CAD",
  IN: "INR",
  NG: "NGN",
  KE: "KES",
  GH: "GHS",
  BW: "BWP",
  NA: "NAD",
  ZM: "ZMW",
  MZ: "MZN",
  AE: "AED",
  SG: "SGD",
};
