// South Africa.
//
// The first market, and the one whose specifics were previously scattered
// through forty files. Everything here is a fact about the country rather
// than a feature: the rate, the period, the shape of a VAT number, who the
// couriers are. No business logic lives in this file and none should.

import type { RegionPack } from "../types";

/** The check digit on a VAT number, which catches a typo without asking SARS. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export const ZA: RegionPack = {
  country: "ZA",
  label: "South Africa",
  currency: "ZAR",
  dateOrder: "dmy",
  locale: "en-ZA",
  weekStartsOn: 1,
  // The tax year runs 1 March to 28/29 February and is named by the year it
  // ends in. It catches everybody out at least once.
  taxYearStartMonth: 2,
  tax: {
    kind: "vat",
    label: "VAT",
    standardRatePercent: 15,
    periodMonths: 2,
    returnName: "VAT201",
    authority: "SARS",
    registrationThreshold: 100_000_000,
    note: "VAT is charged at your own rate and reclaimed on what you buy, so one rate per product is all this needs. Registration becomes compulsory above R1 million of turnover in twelve months.",
  },
  businessNumbers: [
    {
      label: "VAT number",
      example: "4123456784",
      check: (raw) => {
        const digits = raw.replace(/[^0-9]/g, "");
        if (digits.length !== 10) return "A South African VAT number is ten digits. This one is not.";
        if (!digits.startsWith("4")) return "A South African VAT number starts with a 4. This one does not.";
        if (!luhn(digits)) return "The check digit does not work out, so this number has been mistyped or invented.";
        return null;
      },
    },
    {
      label: "Company registration number",
      example: "2019/123456/07",
      check: (raw) => {
        const match = raw.trim().match(/^(\d{4})\/(\d{6})\/(\d{2})$/);
        if (!match) return "A CIPC number looks like 2019/123456/07. This one does not.";
        const year = Number(match[1]);
        if (year < 1900 || year > new Date().getUTCFullYear()) return `${match[1]} is not a year a company could have been registered in.`;
        return null;
      },
    },
  ],
  providers: {
    couriers: [
      { key: "courier-guy", label: "The Courier Guy", what: "Most things, most places. The default for a parcel under 30kg going door to door.", needs: "This business's own Courier Guy API credentials." },
      { key: "aramex", label: "Aramex", what: "Documents and small parcels, and anything crossing a border.", needs: "An Aramex account number and key." },
      { key: "postnet", label: "PostNet to PostNet", what: "Cheap, when the customer is happy to collect from a store.", needs: "No public API. Booked over the counter." },
      { key: "pargo", label: "Pargo pickup point", what: "Customers with no safe delivery address.", needs: "A Pargo merchant account." },
      { key: "dawn-wing", label: "Dawn Wing", what: "Heavier freight and pallets.", needs: "An account with DPD Laser." },
    ],
    marketplaces: [
      { key: "takealot", label: "Takealot", what: "The biggest single channel for most South African retail SMEs.", needs: "A Takealot Seller API key issued to this seller." },
      { key: "bobshop", label: "Bob Shop", what: "Auctions and fixed-price listings.", needs: "No public API. The sales CSV is the connection." },
    ],
    payments: [
      { key: "payfast", label: "PayFast", what: "Cards and instant EFT. The most widely recognised local checkout." },
      { key: "yoco", label: "Yoco", what: "Cards online and on the counter." },
      { key: "ozow", label: "Ozow", what: "Instant EFT, which is the local default and no global tool bothers with.", needs: "An Ozow merchant account." },
      { key: "snapscan", label: "SnapScan", what: "Scan-to-pay, common in hospitality.", needs: "A SnapScan merchant account." },
    ],
    payroll: [
      { key: "simplepay", label: "SimplePay", what: "Payslips, PAYE, UIF and SDL.", needs: "A SimplePay account and API key." },
      { key: "payspace", label: "PaySpace", what: "Larger teams and multi-country payroll.", needs: "A PaySpace account." },
    ],
    banks: [
      { key: "fnb", label: "FNB", what: "Statement import." },
      { key: "absa", label: "Absa", what: "Statement import." },
      { key: "standard", label: "Standard Bank", what: "Statement import." },
      { key: "nedbank", label: "Nedbank", what: "Statement import." },
      { key: "capitec", label: "Capitec", what: "Statement import." },
    ],
  },
  // Load-shedding is the clearest example there will ever be of something
  // genuinely meaningless elsewhere.
  features: ["power-schedule", "company-registry-lookup", "local-payroll", "local-marketplaces", "local-couriers"],
  privacy: { law: "POPIA", regulator: "the Information Regulator", subjectDays: 30 },
};
