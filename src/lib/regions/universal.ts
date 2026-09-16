// What a business gets when nothing is known about where it is.
//
// This is not a degraded mode. It is the product, and every pack is a thin
// set of corrections on top of it. A business in a country nobody has written
// a pack for gets a working invoicing, quoting, job and ledger system with
// sensible defaults and no pretending — the only things missing are the local
// couriers and the local registry lookups, which are conveniences rather than
// the product.
//
// It is also what keeps the packs honest: anything that looks wrong here is a
// feature that was built for somewhere rather than built properly.

import type { RegionPack } from "./types";

export const UNIVERSAL: RegionPack = {
  country: "*",
  label: "Anywhere else",
  // USD because it is the currency most widely understood as a placeholder,
  // and because a workspace that never says where it is will be corrected the
  // moment somebody sets a country. It is never guessed from a browser.
  currency: "USD",
  // The rest of the world writes the day first. Choosing the majority here
  // means the packs that need correcting are the minority.
  dateOrder: "dmy",
  locale: "en-US",
  weekStartsOn: 1,
  taxYearStartMonth: 0,
  tax: {
    kind: "none",
    label: "Tax",
    standardRatePercent: null,
    periodMonths: 3,
    returnName: null,
    authority: null,
    registrationThreshold: null,
    note: "No tax rules are set for this country, so nothing is added automatically. Set a rate on your products and it will be carried onto every document and totalled for your accountant.",
  },
  businessNumbers: [],
  providers: {},
  features: [],
  privacy: {
    law: "your local data protection law",
    regulator: "your data protection authority",
    // Thirty days is the GDPR and POPIA figure and the most common one
    // worldwide. Where a country is stricter, its pack says so.
    subjectDays: 30,
  },
};
