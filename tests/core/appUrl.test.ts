// Two of the fifteen hardcoded fallbacks this replaced were live bugs, and
// the worse one was silent: a portal payment built its notify URL from
// http://localhost:3000, so the provider could never post the outcome and
// the invoice stayed unpaid forever with nothing in the logs.
//
// So what these tests defend is the ordering, and that the result is never
// empty — a caller building a URL out of this should not have to check it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { baseUrlWithoutRequest } from "../../src/lib/appUrl";

const KEYS = ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the origin, with no request to read", () => {
  it("prefers an explicit setting, because somebody setting it meant it", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://flow.example";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.vercel.app";
    expect(baseUrlWithoutRequest()).toBe("https://flow.example");
  });

  it("falls back to the deployment's own production domain", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "skynatflow.vercel.app";
    expect(baseUrlWithoutRequest()).toBe("https://skynatflow.vercel.app");
  });

  it("uses the per-deployment URL when there is no project domain", () => {
    process.env.VERCEL_URL = "preview-abc123.vercel.app";
    expect(baseUrlWithoutRequest()).toBe("https://preview-abc123.vercel.app");
  });

  it("only reaches localhost when nothing else is known", () => {
    expect(baseUrlWithoutRequest()).toBe("http://localhost:3000");
  });

  it("never ends in a slash, so joining a path cannot double it", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://flow.example/";
    expect(baseUrlWithoutRequest()).toBe("https://flow.example");
    expect(`${baseUrlWithoutRequest()}/portal`).toBe("https://flow.example/portal");
  });

  it("never returns an empty string", () => {
    // The old `|| ""` fallbacks produced relative URLs where an absolute one
    // was required — a webhook address a provider cannot resolve.
    for (const value of ["", "   "]) {
      process.env.NEXT_PUBLIC_APP_URL = value;
      expect(baseUrlWithoutRequest().length).toBeGreaterThan(0);
    }
  });
});

describe("nothing builds a URL from a hardcoded guess any more", () => {
  it("has no NEXT_PUBLIC_APP_URL fallbacks left in the codebase", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) {
          const src = readFileSync(full, "utf8");
          if (/process\.env\.NEXT_PUBLIC_APP_URL\s*\|\|/.test(src)) offenders.push(full);
        }
      }
    };
    walk("src");

    expect(
      offenders,
      `these build a URL from a hardcoded guess instead of appUrl: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
