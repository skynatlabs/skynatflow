// Two navigations, one app.
//
// The dashboard renders one of two sidebars depending on the platform's
// colour skin: the Admina twin rail (adminaNav.tsx) or the original flat
// list (defined inline in layout.tsx). Nothing forces them to agree, and
// they silently stopped agreeing — three pages were added to one and not the
// other, so on the live site they existed, worked, and were unreachable.
//
// That is the worst kind of bug in this codebase's recurring family: the
// feature is built, deployed and correct, and simply has no door. These
// tests read both nav sources and the routes on disk, and fail when they
// drift apart.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const DASH = join(process.cwd(), "src/app/dashboard/[tenantId]");

function hrefsIn(file: string): Set<string> {
  const src = readFileSync(join(DASH, file), "utf8");
  const found = new Set<string>();
  // Both files write hrefs as template literals against the tenant id:
  //   `/dashboard/${tenantId}/books`   or   `${d}/books`
  for (const m of src.matchAll(/`(?:\/dashboard\/\$\{tenantId\}|\$\{d\})\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)`/g)) {
    found.add(m[1]);
  }
  return found;
}

/** Directories under the dashboard that are real, visitable pages. */
function routesOnDisk(): Set<string> {
  const out = new Set<string>();
  for (const entry of readdirSync(DASH, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Dynamic segments are reached from a list page, never from the nav.
    if (entry.name.startsWith("[")) continue;
    const files = readdirSync(join(DASH, entry.name));
    if (files.includes("page.tsx")) out.add(entry.name);
  }
  return out;
}

// Pages that are deliberately not in the nav, with the reason. Anything not
// listed here has to be reachable, or this test fails.
const NOT_IN_NAV = new Map<string, string>([
  ["disputes", "in the nav under the label 'Reports'"],
  ["settings", "its own section; sub-pages hang off it"],
  ["unsent-quotes", "present in the flat nav; the Admina rail groups it under Quotes"],
]);

describe("both sidebars reach the same pages", () => {
  const admina = hrefsIn("adminaNav.tsx");
  const flat = hrefsIn("layout.tsx");

  it("has entries in both", () => {
    expect(admina.size).toBeGreaterThan(20);
    expect(flat.size).toBeGreaterThan(20);
  });

  it("does not offer a page in one sidebar and hide it in the other", () => {
    // Top-level routes only: the Admina rail lists settings sub-pages that
    // the flat nav reaches through the settings page itself.
    const top = (s: Set<string>) => new Set([...s].filter((h) => !h.includes("/")));

    const onlyAdmina = [...top(admina)].filter((h) => !top(flat).has(h));
    const onlyFlat = [...top(flat)].filter((h) => !top(admina).has(h));

    expect(
      { onlyAdmina, onlyFlat },
      "a page reachable from one sidebar and not the other is invisible to " +
        "whichever skin the workspace is actually using"
    ).toEqual({ onlyAdmina: [], onlyFlat: [] });
  });
});

describe("every dashboard page has a door", () => {
  it("is reachable from the navigation, or explicitly exempted", () => {
    const admina = hrefsIn("adminaNav.tsx");
    const flat = hrefsIn("layout.tsx");
    const reachable = new Set([...admina, ...flat]);

    const orphans = [...routesOnDisk()].filter(
      (route) => !reachable.has(route) && !NOT_IN_NAV.has(route)
    );

    expect(
      orphans,
      "these pages exist and work but nothing links to them — add them to " +
        "both sidebars, or to NOT_IN_NAV with the reason"
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a page that no longer exists is stale documentation
    // pretending to be a decision.
    const onDisk = routesOnDisk();
    for (const route of NOT_IN_NAV.keys()) {
      expect(onDisk.has(route), `${route} is exempted but no longer exists`).toBe(true);
    }
  });
});
