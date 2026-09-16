// A phone has room for one thing.
//
// Quotes and invoices shipped a fixed 320px list beside a flexible detail, at
// every width. On a desk that is the right shape and the one every invoicing
// tool uses; on a 375px phone it left about fifty pixels for the document, so
// the detail was technically rendered and effectively invisible.
//
// It is the recurring shape of bug in this codebase: built, deployed,
// correct, and unusable on the device most owners actually carry. These tests
// read the source rather than render it, the same way nav-coverage does,
// because the alternative is a component-testing stack for one assertion.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const APP = join(process.cwd(), "src/app");
const BROWSE_LAYOUTS = [
  "src/app/dashboard/[tenantId]/quotes/(browse)/layout.tsx",
  "src/app/dashboard/[tenantId]/invoices/(browse)/layout.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe("list and detail on a phone", () => {
  it("routes both browse layouts through the shell that collapses to one layer", () => {
    for (const layout of BROWSE_LAYOUTS) {
      const source = readFileSync(join(process.cwd(), layout), "utf8");
      expect(source, `${layout} must use BrowseShell`).toContain("BrowseShell");
      // The old shape: both panels in a row at every width, with no breakpoint.
      expect(source, `${layout} still lays both panels out unconditionally`).not.toMatch(/className="flex h-screen"/);
    }
  });

  it("gives the shell a back link only where the list is off screen", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/dashboard/BrowseShell.tsx"), "utf8");
    // On a desk the list is still beside it, so a back link would point at
    // something already visible.
    expect(shell).toMatch(/md:hidden/);
    // And the two panels each have a breakpoint rather than a fixed width.
    expect(shell).toMatch(/hidden md:flex/);
    expect(shell).toMatch(/md:w-80/);
  });

  it("has no panel left that is a fixed column at every width", () => {
    const offenders: string[] = [];

    for (const file of walk(APP)) {
      const relative = file.slice(process.cwd().length + 1);
      const source = readFileSync(file, "utf8");

      source.split("\n").forEach((line, index) => {
        // A fixed width with no breakpoint, on something that shrinks for
        // nobody. `md:w-80` and `w-80 md:...` are fine; a bare `w-80 shrink-0`
        // is the shape that squeezed the document off a phone.
        if (/\bw-(?:72|80|96)\s+shrink-0\b/.test(line) && !/\bmd:|sm:|lg:/.test(line)) {
          offenders.push(`${relative}:${index + 1}`);
        }
      });
    }

    expect(
      offenders,
      "these are fixed columns at every width — give them a breakpoint, or let a shell decide which panel a phone shows",
    ).toEqual([]);
  });
});
