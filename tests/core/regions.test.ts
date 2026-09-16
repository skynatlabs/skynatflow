// Nothing is written for a country.
//
// Two of these are ordinary behaviour tests. The third is the one that
// matters: a scan of the source for money formatted in somebody's specific
// currency. Sixty-one call sites had drifted into saying rands, above a
// comment in the formatter warning against exactly that, because the
// signature took a default. A comment cannot hold a line; a failing test can.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  COVERED_COUNTRIES,
  PACK_BY_COUNTRY,
  UNIVERSAL,
  dateHint,
  hasFeature,
  parseLocalDate,
  regionFor,
  taxPeriodFor,
  taxYearOf,
} from "../../src/lib/regions";
import { formatMoney } from "../../src/lib/format/money";

describe("a country changes labels, never features", () => {
  it("gives a country nobody has written a pack for a working product", () => {
    const nowhere = regionFor("MG");
    expect(nowhere).toBe(UNIVERSAL);
    // Not a degraded mode: it has a currency, a date order and a working
    // tax stance. What it lacks is local couriers, which are a convenience.
    expect(nowhere.currency).toBeTruthy();
    expect(nowhere.dateOrder).toBe("dmy");
    expect(nowhere.tax.note).toMatch(/set a rate on your products/i);
    expect(nowhere.features).toEqual([]);
  });

  it("falls back rather than throwing on a country nobody named", () => {
    expect(regionFor(null)).toBe(UNIVERSAL);
    expect(regionFor(undefined)).toBe(UNIVERSAL);
    expect(regionFor("")).toBe(UNIVERSAL);
    expect(regionFor("za").country).toBe("ZA");
  });

  it("switches on only what is genuinely meaningless elsewhere", () => {
    // Load-shedding is the clearest example there will ever be.
    expect(hasFeature(PACK_BY_COUNTRY.ZA, "power-schedule")).toBe(true);
    expect(hasFeature(PACK_BY_COUNTRY.US, "power-schedule")).toBe(false);
    expect(hasFeature(PACK_BY_COUNTRY.GB, "power-schedule")).toBe(false);

    // And nothing that is really universal is gated behind a country.
    for (const pack of Object.values(PACK_BY_COUNTRY)) {
      expect(pack.features.length).toBeLessThanOrEqual(5);
    }
  });

  it("describes each country's tax as the shape it actually is", () => {
    // VAT is charged at the seller's rate and reclaimed, so one rate works.
    expect(PACK_BY_COUNTRY.ZA.tax.kind).toBe("vat");
    expect(PACK_BY_COUNTRY.ZA.tax.standardRatePercent).toBe(15);
    expect(PACK_BY_COUNTRY.GB.tax.standardRatePercent).toBe(20);

    // US sales tax depends on the buyer and is never reclaimed. A national
    // rate would be the most expensive kind of wrong, so there is none.
    expect(PACK_BY_COUNTRY.US.tax.kind).toBe("sales-tax");
    expect(PACK_BY_COUNTRY.US.tax.standardRatePercent).toBeNull();
    expect(PACK_BY_COUNTRY.US.tax.note).toMatch(/does not pretend/i);
  });

  it("knows each country's tax year, which is where systems built elsewhere go wrong", () => {
    const march = new Date("2026-03-03T00:00:00Z");
    const february = new Date("2026-02-27T00:00:00Z");

    // South Africa's year runs March to February and is named by its end.
    expect(taxYearOf(march, PACK_BY_COUNTRY.ZA)).toBe(2027);
    expect(taxYearOf(february, PACK_BY_COUNTRY.ZA)).toBe(2026);
    // The US year is the calendar year.
    expect(taxYearOf(march, PACK_BY_COUNTRY.US)).toBe(2026);
    expect(taxYearOf(february, PACK_BY_COUNTRY.US)).toBe(2026);
  });

  it("uses each country's own return period rather than a fixed two months", () => {
    const date = new Date("2026-05-15T00:00:00Z");
    // Two months for a small South African vendor, three for the UK.
    const za = taxPeriodFor(date, PACK_BY_COUNTRY.ZA);
    const gb = taxPeriodFor(date, PACK_BY_COUNTRY.GB);
    expect(za.start.getUTCMonth()).toBe(4);
    expect(za.end.getUTCMonth()).toBe(5);
    expect(gb.start.getUTCMonth()).toBe(3);
    expect(gb.end.getUTCMonth()).toBe(5);
  });

  it("validates the business numbers each country actually asks for", () => {
    const zaVat = PACK_BY_COUNTRY.ZA.businessNumbers.find((n) => n.label === "VAT number")!;
    expect(zaVat.check("4123456784")).toBeNull();
    expect(zaVat.check("4123456789")).toMatch(/check digit/i);

    const ein = PACK_BY_COUNTRY.US.businessNumbers.find((n) => n.label === "EIN")!;
    expect(ein.check("12-3456789")).toBeNull();
    expect(ein.check("07-1234567")).toMatch(/has ever started/i);
    expect(ein.check("123")).toMatch(/nine digits/i);

    const gbVat = PACK_BY_COUNTRY.GB.businessNumbers.find((n) => n.label === "VAT number")!;
    expect(gbVat.check("GB123456782")).toBeNull();
    expect(gbVat.check("GB123456789")).toMatch(/check digits/i);
  });

  it("names the privacy law a business in that country actually answers to", () => {
    expect(PACK_BY_COUNTRY.ZA.privacy.law).toBe("POPIA");
    expect(PACK_BY_COUNTRY.GB.privacy.regulator).toMatch(/ICO/);
    expect(PACK_BY_COUNTRY.US.privacy.law).toMatch(/CCPA/);
    // California allows longer than the GDPR's thirty days.
    expect(PACK_BY_COUNTRY.US.privacy.subjectDays).toBe(45);
  });

  it("lists what it covers, so a screen can say so honestly", () => {
    expect(COVERED_COUNTRIES.map((c) => c.country)).toEqual(expect.arrayContaining(["ZA", "US", "GB"]));
    for (const { label } of COVERED_COUNTRIES) expect(label.length).toBeGreaterThan(2);
  });
});

describe("reading a date the way the country writes it", () => {
  it("reads the same string two different ways, and both are right", () => {
    // The bug this exists to prevent: a US migration silently mis-dated by up
    // to eleven months, with nothing looking broken.
    const american = parseLocalDate("03/04/2026", "mdy")!;
    const everyone = parseLocalDate("03/04/2026", "dmy")!;
    expect(american.getUTCMonth()).toBe(2);
    expect(american.getUTCDate()).toBe(4);
    expect(everyone.getUTCMonth()).toBe(3);
    expect(everyone.getUTCDate()).toBe(3);
  });

  it("takes an ISO date at its word whatever the country", () => {
    for (const order of ["dmy", "mdy", "ymd"] as const) {
      const date = parseLocalDate("2026-07-14", order)!;
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(6);
      expect(date.getUTCDate()).toBe(14);
    }
  });

  it("rescues a value that can only be a day, whatever the country says", () => {
    // 25 cannot be a month. Reading it wrong would be worse than reading it.
    const date = parseLocalDate("25/12/2026", "mdy")!;
    expect(date.getUTCMonth()).toBe(11);
    expect(date.getUTCDate()).toBe(25);
  });

  it("expands a two-digit year the way a person means it", () => {
    expect(parseLocalDate("01/02/26", "dmy")!.getUTCFullYear()).toBe(2026);
    expect(parseLocalDate("01/02/98", "dmy")!.getUTCFullYear()).toBe(1998);
  });

  it("returns nothing rather than a wrong date", () => {
    expect(parseLocalDate("", "dmy")).toBeUndefined();
    expect(parseLocalDate(null, "dmy")).toBeUndefined();
    expect(parseLocalDate("not a date at all", "dmy")).toBeUndefined();
  });

  it("tells a form what shape to expect", () => {
    expect(dateHint("mdy")).toBe("mm/dd/yyyy");
    expect(dateHint("dmy")).toBe("dd/mm/yyyy");
  });
});

describe("money belongs to the workspace", () => {
  it("writes the same figure in each currency's own convention", () => {
    expect(formatMoney(4_500_000, "ZAR")).toMatch(/R/);
    expect(formatMoney(4_500_000, "USD")).toMatch(/\$/);
    expect(formatMoney(4_500_000, "GBP")).toMatch(/£/);
    expect(formatMoney(4_500_000, "EUR")).toMatch(/€/);
  });

  it("writes a currency nobody listed rather than throwing", () => {
    // Intl knows far more codes than the locale table here does, and it
    // renders them correctly on its own — XPF comes out as CFPF.
    expect(formatMoney(100_000, "XPF")).toMatch(/1[\s,.]?000/);

    // A code Intl has never heard of still has to produce something: it is
    // somebody's money, and an exception in a formatter takes a page down.
    const invented = formatMoney(100_000, "QQQ");
    expect(invented).toContain("QQQ");
  });

  // ------------------------------------------------------------ the guard
  //
  // The test that earns its place. Everything above would have passed on the
  // day sixty-one call sites were quietly formatting in rands.

  const SRC = join(process.cwd(), "src");

  /**
   * Files allowed to name a specific currency.
   *
   * Each is genuinely about one country: a region pack describes it, a local
   * payment provider only settles in it, and the payroll tables are a
   * country's own published figures.
   */
  const MAY_NAME_A_CURRENCY = [
    "src/lib/regions/",
    "src/lib/format/money.ts",
    // Yoco and PayFast are South African acquirers and settle in rands only.
    "src/lib/payments/gateways/yoco.ts",
    "src/lib/pos/providers/yoco.ts",
    // SARS's own published tables and forms.
    "src/lib/core/payroll.ts",
    "src/lib/core/sarsFiling.ts",
    "src/lib/core/companyLookup.ts",
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("has nowhere left that writes money in one country's currency", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const relative = file.slice(process.cwd().length + 1);
      if (MAY_NAME_A_CURRENCY.some((allowed) => relative.startsWith(allowed))) continue;

      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        // A hardcoded ISO code in a formatter call, or a bare currency sign
        // interpolated in front of an amount. Both produce a figure in
        // somebody else's money that looks perfectly correct.
        const hardcodedCode = /currency:\s*["'](?:ZAR|USD|GBP|EUR|AUD|NZD|CAD)["']/.test(line);
        const bareSymbol = /[`'"](?:R|\$|£|€)\$\{/.test(line);
        const localeMoney = /toLocaleString\(\s*["'][a-z]{2}-[A-Z]{2}["']\s*,\s*\{[^}]*style:\s*["']currency["']/.test(line);
        // The one that got through the first time: formatMoney is the right
        // function, called with a currency somebody typed rather than one the
        // workspace supplied. Using the correct helper wrongly is exactly the
        // shape a guard has to catch, because it looks right in review.
        const literalToFormatMoney = /formatMoney\([^)]*,\s*["'][A-Z]{3}["']/.test(line);
        if (hardcodedCode || bareSymbol || localeMoney || literalToFormatMoney) {
          offenders.push(`${relative}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      "these write money in a fixed currency — take it from the workspace instead (formatMoney(cents, currency), moneyOf(tenantId), or useMoney())",
    ).toEqual([]);
  });

  it("has nowhere left that formats a date in one country's locale", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const relative = file.slice(process.cwd().length + 1);
      if (MAY_NAME_A_CURRENCY.some((allowed) => relative.startsWith(allowed))) continue;

      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        // A fixed locale on a date is the same bug wearing different clothes:
        // it writes 4 March where a reader expects March 4.
        // Only dates and times. A plain number formatted with a fixed locale
        // differs by a thousands separator, which is not worth the noise this
        // test would generate — the bug being guarded is 4 March read as
        // March 4, not 1,000 written as 1 000.
        if (/toLocale(?:Date|Time)String\(\s*["'][a-z]{2}-[A-Z]{2}["']/.test(line)) {
          offenders.push(`${relative}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      "these format a date in a fixed locale — use the workspace's (regionOf(tenantId).locale) or undefined for the reader's own",
    ).toEqual([]);
  });
});
