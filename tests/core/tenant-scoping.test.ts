// Every read of a tenant-scoped table must say which tenant.
//
// The application's isolation story is 247 calls to requireTenantAccess plus
// a core layer that always filters. That is genuinely thorough, and it has
// one failure mode: somebody writes a query that looks up a row by bare id,
// and the caller passes an id that came off a form. The existing
// cross-tenant regression suite catches the ones we thought of. This catches
// the shape, before anybody thinks of it.
//
// WHY THIS RATHER THAN POSTGRES ROW-LEVEL SECURITY
//
// RLS is the textbook answer and would be better. It needs the connection to
// carry the current tenant — `SET LOCAL app.tenant_id` inside a transaction —
// on every query. This app pools connections and does not wrap requests in a
// transaction, so the setting would either be missing or, far worse, left
// over from the previous request on that connection. A leaked tenant id in a
// pooled session is a cross-tenant read that looks like a correct one.
//
// Doing it properly means routing every query through a transaction wrapper,
// which is a real project. Until then this guards the same class of mistake
// at build time, where it costs nothing and cannot leak anything.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CORE = "src/lib/core";
const SCHEMA = "prisma/schema.prisma";

/** Models with a tenantId column — the ones a query must scope. */
function tenantScopedModels(): Set<string> {
  const schema = readFileSync(SCHEMA, "utf8");
  const models = new Set<string>();
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const name = block.slice(0, block.indexOf(" ")).trim();
    const body = block.slice(0, block.indexOf("\n}"));
    if (/\n\s+tenantId\s+String/.test(body)) {
      // Prisma's client property is the model name, lower-cased first letter.
      models.add(name[0].toLowerCase() + name.slice(1));
    }
  }
  return models;
}

const READS = ["findMany", "findFirst", "findUnique", "updateMany", "deleteMany", "count", "aggregate", "groupBy"];

interface Unscoped {
  file: string;
  line: number;
  model: string;
  op: string;
}

/**
 * Find queries on a tenant-scoped model whose argument never mentions a
 * tenant.
 *
 * Deliberately generous about HOW the tenant appears: `tenantId`, a nested
 * relation filter like `item: { tenantId }`, or a variable named for it all
 * count. The goal is to catch a query that forgot entirely, not to police
 * style.
 */
function unscopedQueries(source: string, file: string, models: Set<string>): Unscoped[] {
  const found: Unscoped[] = [];
  const pattern = new RegExp(`\\b(?:prisma|tx)\\.(\\w+)\\.(${READS.join("|")})\\(`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const [, model, op] = match;
    if (!models.has(model)) continue;

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
    if (!/tenantId|tenant:/i.test(argument)) {
      found.push({ file, line: source.slice(0, match.index).split("\n").length, model, op });
    }
  }
  return found;
}

/**
 * Queries that legitimately do not name a tenant.
 *
 * Each one is here because the row is reached by something already proven to
 * belong to the workspace, or because the table is genuinely platform-wide.
 */
const ALLOWED = new Set([
  // Deletes every row a workspace owns, driven off the schema. Scoping is the
  // whole operation, expressed as raw SQL rather than as a where clause.
  "accountClosure.ts",
  // Reads the shared obligation library, which belongs to no workspace.
  "obligationLibrary.ts",
  "obligationLibrarySeed.ts",
  // Exchange rates for a day, shared by every workspace and owned by none.
  "fx.ts",
  // A shared catalogue of agent templates, published across the platform.
  "recipes.ts",
  // The platform margin view reads every subscription, because a view of
  // what the platform earns has no single tenant to scope to. Every
  // per-workspace read in this file IS scoped — billFor and seatCounts both
  // filter — and this exemption should be revisited if that stops being true.
  "billing.ts",
]);

function scan(): Unscoped[] {
  const models = tenantScopedModels();
  return readdirSync(CORE)
    .filter((f) => f.endsWith(".ts") && !ALLOWED.has(f))
    .flatMap((f) => unscopedQueries(readFileSync(join(CORE, f), "utf8"), f, models));
}

/**
 * Where it stood when this guard went in.
 *
 * Same ratchet as the query-bounds test: may fall, may never rise. Each one
 * that comes off is a query that can no longer read another company's row if
 * somebody upstream forgets a check.
 *
 * Written as a literal rather than computed from scan(), which is what this
 * file did first — a ratchet measured against itself can never fail, and a
 * test that cannot fail is worse than no test, because it reads like cover.
 */
const BASELINE = 98;

describe("tenant scoping", () => {
  it("knows which models are tenant-scoped", () => {
    const models = tenantScopedModels();
    expect(models.has("transaction")).toBe(true);
    expect(models.has("party")).toBe(true);
    expect(models.has("auditLog")).toBe(true);
    // Not scoped: these belong to the platform, not to a workspace.
    expect(models.has("user")).toBe(false);
    expect(models.has("fxRate")).toBe(false);
  });

  it("spots a query that forgot the tenant", () => {
    const models = new Set(["transaction"]);
    expect(unscopedQueries('prisma.transaction.findFirst({ where: { id } })', "t.ts", models)).toHaveLength(1);
    expect(unscopedQueries('prisma.transaction.findFirst({ where: { id, tenantId } })', "t.ts", models)).toHaveLength(0);
    // A nested relation filter counts: the parent carries the scope.
    expect(
      unscopedQueries('prisma.transaction.findMany({ where: { item: { tenantId } } })', "t.ts", models)
    ).toHaveLength(0);
    // An untracked model is nobody's business here.
    expect(unscopedQueries('prisma.user.findFirst({ where: { id } })', "t.ts", models)).toHaveLength(0);
  });

  it("does not let unscoped queries multiply", () => {
    const found = scan();

    if (found.length < BASELINE) {
      // Going down is the point. Lower BASELINE so the ground is kept.
      throw new Error(
        `Unscoped queries are down to ${found.length} from ${BASELINE} — lower BASELINE in this file.`
      );
    }

    const sample = found.slice(0, 5).map((u) => `${u.file}:${u.line} ${u.model}.${u.op}`).join(", ");
    expect(
      found.length,
      `Unscoped queries on tenant-owned tables went up. Each one reads by bare id and trusts ` +
        `the caller to have checked. Add tenantId to the where clause. Examples: ${sample}`
    ).toBeLessThanOrEqual(BASELINE);
  });
});
