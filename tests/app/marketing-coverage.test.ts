// The marketing site, held to the same standard as the dashboard.
//
// The dashboard's two sidebars drifted apart once and three pages became
// unreachable — built, deployed, correct, and with no door. The marketing
// site is worse when that happens, because an unreachable page there is a
// thing the business is paying to build and nobody can find.
//
// So the nav, the footer and the feature pages all read one list, and these
// tests check the list against what is actually on disk.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_CATEGORIES, allFeatures, categoryBySlug } from "../../src/lib/marketing/features";

const MARKETING = join(process.cwd(), "src/app/(marketing)");
const CHROME = join(process.cwd(), "src/components/marketing/chrome.tsx");

describe("the feature catalogue", () => {
  it("has a page for every category", () => {
    // One dynamic route serves them all; what matters is that it exists and
    // that the catalogue is what it is built from.
    expect(existsSync(join(MARKETING, "features/[category]/page.tsx"))).toBe(true);
    expect(existsSync(join(MARKETING, "features/page.tsx"))).toBe(true);

    const route = readFileSync(join(MARKETING, "features/[category]/page.tsx"), "utf8");
    expect(route).toContain("generateStaticParams");
    expect(route).toContain("FEATURE_CATEGORIES");
  });

  it("resolves every slug", () => {
    for (const category of FEATURE_CATEGORIES) {
      expect(categoryBySlug(category.slug), `${category.slug} does not resolve`).toBeDefined();
    }
    expect(categoryBySlug("not-a-real-category")).toBeUndefined();
  });

  it("has no duplicate slugs", () => {
    const slugs = FEATURE_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses slugs that are safe in a URL", () => {
    for (const category of FEATURE_CATEGORIES) {
      expect(category.slug, `${category.slug} is not url-shaped`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("builds the nav and the footer from the catalogue, not from a second list", () => {
    const chrome = readFileSync(CHROME, "utf8");
    expect(chrome).toContain("FEATURE_CATEGORIES");
    // If somebody types a feature path by hand in the chrome, the two can
    // drift — which is the whole failure this file exists to prevent.
    const handTyped = chrome.match(/href="\/features\/[a-z-]+"/g) ?? [];
    expect(handTyped, `hand-typed feature links in chrome.tsx: ${handTyped.join(", ")}`).toHaveLength(0);
  });
});

describe("the copy itself", () => {
  const features = allFeatures();

  it("covers a real amount of ground", () => {
    // A regression well below this means a category was dropped by accident.
    expect(features.length).toBeGreaterThanOrEqual(120);
    expect(FEATURE_CATEGORIES.length).toBeGreaterThanOrEqual(10);
  });

  it("leads with a benefit rather than a feature name", () => {
    for (const feature of features) {
      // A benefit is a sentence about the reader's business. A feature name
      // is two or three words. The length check is blunt on purpose.
      expect(
        feature.benefit.length,
        `"${feature.name}" has a benefit that reads like a label: "${feature.benefit}"`
      ).toBeGreaterThan(25);
      // And it must not simply restate the name.
      expect(
        feature.benefit.toLowerCase().trim(),
        `"${feature.name}" repeats its own name as the benefit`
      ).not.toBe(feature.name.toLowerCase().trim());
    }
  });

  it("explains how each one works, not just why it matters", () => {
    for (const feature of features) {
      expect(
        feature.how.length,
        `"${feature.name}" has no real explanation behind the benefit`
      ).toBeGreaterThan(60);
    }
  });

  it("gives every category a thesis and a standfirst", () => {
    for (const category of FEATURE_CATEGORIES) {
      expect(category.thesis.length, `${category.slug} has no thesis`).toBeGreaterThan(40);
      expect(category.standfirst.length, `${category.slug} has no standfirst`).toBeGreaterThan(80);
      expect(category.headline.length, `${category.slug} has no headline`).toBeGreaterThan(8);
      expect(category.headlineAccent.length, `${category.slug} has no accent`).toBeGreaterThan(3);
    }
  });

  it("gives every category at least a handful of things", () => {
    for (const category of FEATURE_CATEGORIES) {
      expect(category.features.length, `${category.slug} is thin`).toBeGreaterThanOrEqual(6);
    }
  });

  it("states what has to be connected rather than implying it is already live", () => {
    // Anything claiming a live third-party connection must either carry a
    // `needs`, or say inside its own copy what it depends on. A page that
    // promises an integration nobody can switch on loses the second month.
    const CONNECTED = /bank feed|whatsapp|mailbox|gateway|courier/i;
    for (const feature of features) {
      if (!CONNECTED.test(feature.name)) continue;
      const declares = feature.needs !== undefined || /needs|requires|your own|in your (own )?name/i.test(feature.how);
      expect(declares, `"${feature.name}" implies a live connection without saying what it needs`).toBe(true);
    }
  });

  it("does not promise an export it does not have, or hide the lock-in it does", () => {
    // The stance is deliberate and written down: there is no one-click
    // offboarding, because SARS requires five years of invoice retention.
    // The honest version — a copy of the records offered when an owner
    // closes the account — is what the copy must say.
    const text = JSON.stringify(FEATURE_CATEGORIES).toLowerCase();
    expect(text).not.toMatch(/one-click (csv )?export of your entire business/);
    expect(text).toMatch(/copy of every table|copy of the records|complete copy/);
  });
});

describe("every marketing page still has a door", () => {
  it("is linked from the chrome, or is deliberately not", () => {
    const chrome = readFileSync(CHROME, "utf8");
    const linked = new Set(
      [...chrome.matchAll(/href="\/([a-z0-9/[\]-]+)"/g)].map((m) => m[1].split("/")[0])
    );

    // Pages reached from somewhere other than the nav, with the reason.
    const NOT_IN_CHROME = new Map<string, string>([
      ["legal", "reached from the footer's own legal links"],
      ["ai", "an older CMS-driven page; the AI now has a features category"],
      ["compare", "an older CMS-driven page kept for existing inbound links"],
    ]);

    const onDisk = readdirSync(MARKETING, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("["))
      .filter((e) => existsSync(join(MARKETING, e.name, "page.tsx")) || e.name === "legal")
      .map((e) => e.name);

    const orphans = onDisk.filter((name) => !linked.has(name) && !NOT_IN_CHROME.has(name));
    expect(
      orphans,
      `these marketing pages exist and nothing links to them: ${orphans.join(", ")}`
    ).toEqual([]);
  });
});
