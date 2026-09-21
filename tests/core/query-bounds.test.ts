// A ratchet on unbounded reads.
//
// 222 calls to findMany in the core layer ask the database for every matching
// row. At a thousand rows that is free. At fifty thousand — which is one
// established business with three years of history — it is a page that takes
// six seconds and a connection held open while it does.
//
// Fixing all 222 at once would be a very large change with no way to tell
// which of them mattered, so this is a ratchet instead: the number may go
// down and may never go up. A new unbounded read fails the build; an old one
// is a debt this test keeps visible and countable rather than letting it
// quietly grow.
//
// When you bound one, lower BASELINE. It should only ever move one way.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CORE = "src/lib/core";

/**
 * The count as it stood when this test was written.
 *
 * Deliberately exact rather than a ceiling with slack in it: slack is where
 * three more creep in unnoticed.
 */
const BASELINE = 222;

/**
 * Reads whose shape makes a limit meaningless.
 *
 * A file here is exempt because it genuinely must see every row — an export
 * that claims completeness, or a sweep that exists to touch everything. Each
 * one needs a reason, and "it would be annoying to fix" is not one.
 */
const MUST_SEE_EVERYTHING = new Set([
  // Taking everything and leaving. An export that silently stopped at a page
  // would be worse than no export at all.
  "portability.ts",
  // Deletes every row a workspace owns. A limit here would leave data behind.
  "accountClosure.ts",
]);

interface Unbounded {
  file: string;
  line: number;
}

/** Every findMany whose argument object has no `take`. */
function unboundedReads(source: string, file: string): Unbounded[] {
  const found: Unbounded[] = [];
  const pattern = /\.findMany\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    // Walk to the end of the argument object so that a `take` belonging to a
    // nested include is not mistaken for one on the query itself — and, more
    // importantly, so that a `take` on the query IS found however the call is
    // formatted.
    let depth = 0;
    let started = false;
    let i = match.index + match[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") {
        depth += 1;
        started = true;
      } else if (c === "}") {
        depth -= 1;
        if (started && depth === 0) break;
      } else if (c === ")" && !started) {
        break;
      }
    }
    const argument = source.slice(match.index, i + 1);
    if (!argument.includes("take:")) {
      found.push({ file, line: source.slice(0, match.index).split("\n").length });
    }
  }
  return found;
}

function scanCore(): Unbounded[] {
  const files = readdirSync(CORE).filter((f) => f.endsWith(".ts"));
  return files
    .filter((f) => !MUST_SEE_EVERYTHING.has(f))
    .flatMap((f) => unboundedReads(readFileSync(join(CORE, f), "utf8"), f));
}

describe("unbounded reads", () => {
  it("finds a take wherever it is written", () => {
    // Guards the scanner itself: a false negative here would let the ratchet
    // slip without anybody noticing.
    expect(unboundedReads("prisma.x.findMany({ where: { a: 1 }, take: 10 })", "t.ts")).toHaveLength(0);
    expect(unboundedReads("prisma.x.findMany({\n  where: { a: 1 },\n  take: 10,\n})", "t.ts")).toHaveLength(0);
    expect(unboundedReads("prisma.x.findMany({ where: { a: 1 } })", "t.ts")).toHaveLength(1);
    expect(unboundedReads("prisma.x.findMany()", "t.ts")).toHaveLength(1);
  });

  it("does not let the debt grow", () => {
    const found = scanCore();

    if (found.length > BASELINE) {
      const worst = found.slice(-6).map((u) => `${u.file}:${u.line}`).join(", ");
      throw new Error(
        `Unbounded reads went from ${BASELINE} to ${found.length}. ` +
          `A findMany with no take asks for every matching row, which is free until a ` +
          `customer has fifty thousand of something. Add take (and a cursor if the ` +
          `caller pages), or bound it by date. Recent: ${worst}`
      );
    }

    // Went down. Lower the baseline so the gain cannot be given back.
    expect(
      found.length,
      `Unbounded reads are down to ${found.length} — lower BASELINE in this file to keep the ground.`
    ).toBe(BASELINE);
  });
});
