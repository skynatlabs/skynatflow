// The United States.
//
// The target market, and the one that breaks the most assumptions a product
// built anywhere else quietly makes. Three of them matter:
//
//   THE DATE IS WRITTEN MONTH FIRST. 03/04/2026 is the fourth of March here
//   and the third of April almost everywhere else. An importer that assumes
//   either one silently mis-dates a year of history, which is worse than
//   failing, because nothing looks broken.
//
//   SALES TAX IS NOT VAT. It is charged at the buyer's location across
//   thousands of overlapping jurisdictions, and it is never reclaimed on
//   inputs. One rate per product cannot express that, so this pack says so
//   rather than producing a number that looks right and is not.
//
//   THE TAX YEAR IS THE CALENDAR YEAR, and the week starts on Sunday.

import type { RegionPack } from "../types";

export const US: RegionPack = {
  country: "US",
  label: "United States",
  currency: "USD",
  dateOrder: "mdy",
  locale: "en-US",
  weekStartsOn: 0,
  taxYearStartMonth: 0,
  tax: {
    kind: "sales-tax",
    label: "Sales tax",
    // Deliberately null. There is no national rate, and a placeholder here
    // would be the most expensive kind of wrong.
    standardRatePercent: null,
    periodMonths: 3,
    returnName: null,
    authority: "your state's department of revenue",
    registrationThreshold: null,
    note:
      "Sales tax here depends on where your customer is, not where you are, and it is not reclaimed on what you buy. Set the rate you actually charge on each product and it is carried onto documents and totalled for your accountant. Working it out per address across every jurisdiction needs a dedicated tax service, and this does not pretend to do it.",
  },
  businessNumbers: [
    {
      label: "EIN",
      example: "12-3456789",
      check: (raw) => {
        const digits = raw.replace(/[^0-9]/g, "");
        if (digits.length !== 9) return "An EIN is nine digits, usually written 12-3456789. This one is not.";
        // The first two digits are the campus prefix. A handful were never
        // issued, and catching those is most of what can be checked without
        // asking the IRS.
        const prefix = Number(digits.slice(0, 2));
        const NEVER_ISSUED = [7, 8, 9, 17, 18, 19, 28, 29, 49, 78, 79, 89];
        if (NEVER_ISSUED.includes(prefix)) return `No EIN has ever started with ${digits.slice(0, 2)}, so this one has been mistyped.`;
        return null;
      },
    },
    {
      label: "State registration number",
      example: "varies by state",
      check: (raw) =>
        raw.trim().length < 4 ? "That looks too short to be a registration number." : null,
    },
  ],
  providers: {
    couriers: [
      { key: "ups", label: "UPS", what: "Ground and air, almost everywhere.", needs: "A UPS account and API credentials." },
      { key: "fedex", label: "FedEx", what: "Overnight and heavier freight.", needs: "A FedEx developer account." },
      { key: "usps", label: "USPS", what: "Cheapest for small and light, and the only one that reaches every address.", needs: "A USPS Web Tools account." },
      { key: "easypost", label: "EasyPost", what: "One connection that covers all of the above, plus rate shopping.", needs: "An EasyPost account." },
    ],
    marketplaces: [
      { key: "amazon", label: "Amazon Seller", what: "The channel that decides most US retail SMEs' year.", needs: "An Amazon SP-API application." },
      { key: "etsy", label: "Etsy", what: "Handmade and small-batch.", needs: "An Etsy app." },
      { key: "ebay", label: "eBay", what: "New and used, auction and fixed price.", needs: "An eBay developer account." },
      { key: "walmart", label: "Walmart Marketplace", what: "Growing fast and less crowded than Amazon.", needs: "A Walmart seller account." },
    ],
    payments: [
      { key: "stripe", label: "Stripe", what: "Cards online. The default here, and already connected." },
      { key: "square", label: "Square", what: "Cards on the counter and online.", needs: "A Square developer application." },
      { key: "paypal", label: "PayPal", what: "Still how a large share of US customers prefer to pay.", needs: "A PayPal business account." },
      { key: "authorize-net", label: "Authorize.Net", what: "Long-established gateway, common with older merchant accounts.", needs: "An Authorize.Net account." },
    ],
    payroll: [
      { key: "gusto", label: "Gusto", what: "Payroll, federal and state filings, and benefits for small teams.", needs: "A Gusto account and API access." },
      { key: "adp", label: "ADP", what: "Larger teams and multi-state payroll.", needs: "An ADP account." },
      { key: "rippling", label: "Rippling", what: "Payroll bundled with device and app management.", needs: "A Rippling account." },
    ],
    banks: [{ key: "plaid", label: "Plaid", what: "One connection that reaches most US banks for statement and balance feeds.", needs: "A Plaid account." }],
  },
  // No power-schedule and no local-payroll: US payroll is federal plus fifty
  // states and belongs with a provider, not in a table here. Saying so is
  // better than a half-built version that gets a withholding wrong.
  features: ["company-registry-lookup", "local-marketplaces", "local-couriers"],
  privacy: {
    law: "state privacy law, such as the CCPA in California",
    regulator: "your state attorney general",
    // California allows 45 days and permits an extension; the shorter figure
    // is the safe one to plan against.
    subjectDays: 45,
  },
};
