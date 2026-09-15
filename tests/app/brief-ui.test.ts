// The Brief's two failure modes are both invisible until a page renders.
//
// An officer added to the enum without a label on the desk reads as
// `OFFICER[...]` being undefined, and the page throws on `.ink` — so the
// screen that exists to show every officer is the one that breaks when a new
// one arrives. And a kb-* class used in markup but never defined in CSS
// renders as raw browser chrome inside a themed panel: kb-input was in that
// state across ten pages before this test existed.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Officer } from "@prisma/client";

const DASH = join(process.cwd(), "src/app/dashboard/[tenantId]");
const CSS = ["src/app/globals.css", "src/app/admina.css"].map((p) =>
  readFileSync(join(process.cwd(), p), "utf8")
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

describe("every officer has a face", () => {
  const brief = readFileSync(join(DASH, "brief/page.tsx"), "utf8");
  const settings = readFileSync(join(DASH, "settings/officers/page.tsx"), "utf8");

  it.each(Object.values(Officer))("the Brief can render a %s finding", (officer) => {
    // Indexed at render time with no fallback, deliberately — a silent
    // "Unknown officer" pill would hide the omission rather than surface it.
    expect(brief).toContain(`${officer}: {`);
  });

  it.each(Object.values(Officer))("%s is listed and settable", (officer) => {
    expect(settings).toContain(`${officer}: {`);
  });
});

describe("no dashboard page uses a kb-* class that does not exist", () => {
  const used = new Map<string, string>();

  for (const file of walk(DASH)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/className="([^"]*)"/g)) {
      for (const token of match[1].split(/\s+/)) {
        // Strip Tailwind's important prefix and any arbitrary-value suffix.
        const cls = token.replace(/^!/, "").split("[")[0];
        if (/^kb-[a-z0-9-]+$/.test(cls) && !used.has(cls)) {
          used.set(cls, file.replace(process.cwd() + "/", ""));
        }
      }
    }
  }

  it("finds classes to check", () => {
    expect(used.size).toBeGreaterThan(5);
  });

  it("has a rule for each one", () => {
    const missing = [...used.entries()]
      // Anchored, so `.kb-pill-primary` cannot stand in for a missing
      // `.kb-pill` — the loose substring check masked exactly that.
      .filter(([cls]) => {
        const rule = new RegExp(`\\.${cls}(?![\\w-])`);
        return !CSS.some((css) => rule.test(css));
      })
      .map(([cls, file]) => `${cls} (first used in ${file})`);

    expect(missing, "a class with no rule renders as unstyled browser chrome").toEqual([]);
  });
});
