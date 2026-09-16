// The United Kingdom.
//
// Here mainly to prove the shape works for a third country without anybody
// touching a feature — and because it is the next market after the US where
// the product needs no translation. The tax year starting on 6 April is the
// oddity that catches every system built elsewhere.

import type { RegionPack } from "../types";

export const GB: RegionPack = {
  country: "GB",
  label: "United Kingdom",
  currency: "GBP",
  dateOrder: "dmy",
  locale: "en-GB",
  weekStartsOn: 1,
  // April, because the personal tax year runs 6 April to 5 April. Companies
  // choose their own year end, which the workspace sets separately.
  taxYearStartMonth: 3,
  tax: {
    kind: "vat",
    label: "VAT",
    standardRatePercent: 20,
    periodMonths: 3,
    returnName: "VAT Return",
    authority: "HMRC",
    registrationThreshold: 9_000_000,
    note: "VAT is charged at your own rate and reclaimed on what you buy. Registration becomes compulsory above £90,000 of turnover in twelve months, and returns are quarterly. Making Tax Digital requires filing through approved software — this produces the figures, not the submission.",
  },
  businessNumbers: [
    {
      label: "VAT number",
      example: "GB123456789",
      check: (raw) => {
        const digits = raw.replace(/[^0-9]/g, "");
        if (digits.length !== 9 && digits.length !== 12) return "A UK VAT number is nine digits, sometimes with a three-digit branch code after it.";
        // The 97-check: weight the first seven digits 8..2, and the total plus
        // the check digits must be divisible by 97.
        const weights = [8, 7, 6, 5, 4, 3, 2];
        const total = weights.reduce((sum, weight, index) => sum + weight * Number(digits[index]), 0);
        const check = Number(digits.slice(7, 9));
        const modern = (total + check) % 97 === 0;
        const older = (total + check + 55) % 97 === 0;
        if (!modern && !older) return "The check digits do not work out, so this number has been mistyped or invented.";
        return null;
      },
    },
    {
      label: "Company number",
      example: "12345678",
      check: (raw) => {
        const value = raw.trim().toUpperCase();
        if (!/^(?:[A-Z]{2})?\d{6,8}$/.test(value)) return "A Companies House number is eight characters, usually all digits.";
        return null;
      },
    },
  ],
  providers: {
    couriers: [
      { key: "royal-mail", label: "Royal Mail", what: "Cheapest for small and light, and reaches every address.", needs: "A Royal Mail Click & Drop account." },
      { key: "dpd", label: "DPD", what: "Next day, with the hour slot customers expect.", needs: "A DPD account." },
      { key: "evri", label: "Evri", what: "Cheap parcels, and drop-off points everywhere.", needs: "An Evri account." },
    ],
    marketplaces: [
      { key: "amazon-uk", label: "Amazon UK", what: "The largest single channel.", needs: "An Amazon SP-API application." },
      { key: "ebay-uk", label: "eBay UK", what: "New and used.", needs: "An eBay developer account." },
      { key: "etsy", label: "Etsy", what: "Handmade and small-batch.", needs: "An Etsy app." },
    ],
    payments: [
      { key: "stripe", label: "Stripe", what: "Cards online. Already connected." },
      { key: "gocardless", label: "GoCardless", what: "Direct Debit, which is how most UK recurring revenue is actually collected.", needs: "A GoCardless account." },
    ],
    payroll: [{ key: "xero-payroll", label: "Xero Payroll", what: "PAYE and RTI submissions.", needs: "A Xero account with payroll." }],
    banks: [{ key: "truelayer", label: "TrueLayer", what: "Open Banking feeds from most UK banks.", needs: "A TrueLayer account." }],
  },
  features: ["company-registry-lookup", "local-marketplaces", "local-couriers"],
  privacy: { law: "UK GDPR and the Data Protection Act 2018", regulator: "the ICO", subjectDays: 30 },
};
