// The section resolver decides what every document a business sends looks
// like, from JSON that was written by an earlier version of the app. The
// failure modes are all quiet: a block silently vanishes, or a block that
// must always print gets switched off and nobody notices until a customer
// receives an invoice with no line items.

import { describe, it, expect } from "vitest";
import {
  SECTION_CATALOGUE,
  SECTION_BY_KEY,
  defaultSections,
  resolveSections,
  sectionsFor,
  findSection,
  fieldOn,
  type SectionConfig,
} from "../../src/lib/pdf/sections";

describe("the catalogue", () => {
  it("gives every section a zone, a label and a hint", () => {
    for (const def of SECTION_CATALOGUE) {
      expect(def.label, def.key).toBeTruthy();
      expect(def.hint, def.key).toBeTruthy();
      expect(["header", "body"]).toContain(def.zone);
    }
  });

  it("has no duplicate keys", () => {
    const keys = SECTION_CATALOGUE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("locks the items table and nothing else", () => {
    // A document with no line items is not a document. Totals used to be
    // locked too, which forced a money total onto delivery slips that
    // deliberately showed no prices.
    expect(SECTION_BY_KEY.itemsTable.locked).toBe(true);
    expect(SECTION_BY_KEY.totals.locked).toBeUndefined();
  });
});

describe("resolveSections", () => {
  it("returns the full catalogue when nothing has been saved", () => {
    const resolved = resolveSections(null);
    expect(resolved).toHaveLength(SECTION_CATALOGUE.length);
    expect(resolved.every((s) => s.visible)).toBe(true);
  });

  it("keeps the saved order rather than the catalogue's", () => {
    const saved: SectionConfig[] = [
      { key: "terms", visible: true },
      { key: "customerDetails", visible: true },
    ];
    const resolved = resolveSections(saved);
    expect(resolved[0].key).toBe("terms");
    expect(resolved[1].key).toBe("customerDetails");
  });

  it("appends a section added to the catalogue after the template was saved", () => {
    // The failure this prevents: storing a list makes that list the whole
    // truth, so a block added later never appears for existing templates and
    // nobody can work out why the feature "doesn't work" for them.
    const saved: SectionConfig[] = [{ key: "itemsTable", visible: true }];
    const resolved = resolveSections(saved);

    expect(resolved).toHaveLength(SECTION_CATALOGUE.length);
    expect(resolved[0].key).toBe("itemsTable");
    const appended = resolved.find((s) => s.key === "signature");
    expect(appended?.visible).toBe(true);
  });

  it("refuses to hide a locked section however the stored JSON got that way", () => {
    const resolved = resolveSections([{ key: "itemsTable", visible: false }]);
    expect(findSection(resolved, "itemsTable")?.visible).toBe(true);
  });

  it("lets a delivery slip drop the totals block entirely", () => {
    const resolved = resolveSections([{ key: "totals", visible: false }]);
    expect(findSection(resolved, "totals")).toBeUndefined();
  });

  it("honours a hidden optional section", () => {
    const resolved = resolveSections([{ key: "verify", visible: false }]);
    expect(resolved.find((s) => s.key === "verify")?.visible).toBe(false);
    expect(findSection(resolved, "verify")).toBeUndefined();
  });

  it("drops entries for sections that no longer exist", () => {
    const resolved = resolveSections([
      { key: "someRemovedSection", visible: true },
      { key: "terms", visible: true },
    ]);
    expect(resolved.some((s) => String(s.key) === "someRemovedSection")).toBe(false);
    expect(resolved).toHaveLength(SECTION_CATALOGUE.length);
  });

  it("survives junk in the column instead of rendering nothing", () => {
    for (const junk of [undefined, "nonsense", 42, {}, [null, 7, "x"]]) {
      const resolved = resolveSections(junk);
      expect(resolved).toHaveLength(SECTION_CATALOGUE.length);
    }
  });

  it("fills every field switch, defaulting the ones not saved", () => {
    const resolved = resolveSections([{ key: "itemsTable", visible: true, fields: { sku: false } }]);
    const table = findSection(resolved, "itemsTable");
    expect(fieldOn(table, "sku")).toBe(false);
    // unitPrice defaults to off in the catalogue, amount to on
    expect(fieldOn(table, "unitPrice")).toBe(false);
    expect(fieldOn(table, "amount")).toBe(true);
  });

  it("keeps an owner's heading and text", () => {
    const resolved = resolveSections([
      { key: "terms", visible: true, title: "Our conditions", body: "Payment in 14 days." },
    ]);
    const terms = findSection(resolved, "terms");
    expect(terms?.title).toBe("Our conditions");
    expect(terms?.body).toBe("Payment in 14 days.");
  });

  it("lets a heading be cleared rather than falling back to the default", () => {
    // An empty string is a decision ("no heading"), not a missing value.
    const resolved = resolveSections([{ key: "terms", visible: true, title: "" }]);
    expect(findSection(resolved, "terms")?.title).toBe("");
  });
});

describe("sectionsFor", () => {
  it("splits the zones and keeps only what is visible", () => {
    const resolved = resolveSections([
      { key: "logo", visible: false },
      { key: "companyDetails", visible: true },
      { key: "terms", visible: true },
    ]);

    const header = sectionsFor(resolved, "header").map((s) => s.key);
    const body = sectionsFor(resolved, "body").map((s) => s.key);

    expect(header).not.toContain("logo");
    expect(header).toContain("companyDetails");
    expect(body).toContain("terms");
    expect(body).not.toContain("companyDetails");
  });
});

describe("defaultSections", () => {
  it("matches the catalogue, with every field at its default", () => {
    const defaults = defaultSections();
    expect(defaults.map((s) => s.key)).toEqual(SECTION_CATALOGUE.map((d) => d.key));

    const table = defaults.find((s) => s.key === "itemsTable");
    expect(table?.fields?.unitPrice).toBe(false);
    expect(table?.fields?.amount).toBe(true);
  });
});
