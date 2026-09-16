// "The AI has access to every feature" is a claim that rots silently: someone
// adds a core module, never adds a tool for it, and the agent quietly can't do
// the new thing. These tests hold the line by checking the registry against
// the actual contents of src/lib/core.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { agentToolNames, MUTATING_TOOLS } from "../../src/lib/agent/tools";
import { EXTRA_READ_TOOLS, EXTRA_WRITE_TOOLS } from "../../src/lib/agent/tools.extra";
import { OPS_READ_TOOLS, OPS_WRITE_TOOLS } from "../../src/lib/agent/tools.ops";

const CORE_DIR = join(process.cwd(), "src/lib/core");

// Modules with no user-facing action to expose: pure helpers, internal plumbing,
// or things the agent must never drive directly.
const NOT_TOOL_SURFACE = new Set([
  // Written as a side effect of other actions, never on request.
  "audit",
  "notifications", // superseded by notifications2, which is wired
  "reviews", // fires automatically when an invoice settles
  "reminders", // driven by the cron schedule, not by a request
  // Pure functions with no state to drive.
  "pricing",
  // Marketing-site content, not workspace data.
  "cms",
  // A static list of ISO country codes with names resolved by Intl. Nothing
  // to drive and no state to change.
  "countries",
  // Curated rows loaded into the shared obligation library the first time a
  // jurisdiction is asked about.
  // The agent reads the library through proposeComplianceCalendar and writes
  // to it through document intake; bulk-seeding it is not a request anyone
  // should be able to make in conversation.
  "obligationLibrarySeed",
  // Formats money in the workspace's currency. A pure function over a code
  // and a number; nothing to drive.
  "currency",
  // Applies captures a phone queued with no signal. Driven by the phone's
  // sync route; trips, stops and proof are reachable through the trip tools.
  "fieldCapture",
  // Removing a business, and the copy of its records offered on the way out.
  // The owner types the business name to close an account; an agent must
  // never be able to start that, and the copy is part of the same flow.
  "accountClosure",
  // The hosts and ports for the mailboxes people already have, so nobody has
  // to look up imap.gmail.com. A lookup table shown on one settings form;
  // connecting the mailbox is the tool, and it lives on the mail module.
  "mailProviders",
  // Reached only through accountClosure now: the whole workspace in one file,
  // offered when an owner closes the account rather than as a day-to-day
  // export. Nothing for the agent to drive.
  "portability",
]);

describe("agent tool coverage", () => {
  it("exposes a broad surface to an owner, not a token handful", () => {
    // The number that matters: before this work it was 4, which is what made
    // "agentic" untrue. A regression below ~50 means modules were dropped.
    expect(agentToolNames("OWNER").length).toBeGreaterThanOrEqual(50);
  });

  it("gives every role the full read surface", () => {
    const readNames = [...Object.keys(EXTRA_READ_TOOLS), ...Object.keys(OPS_READ_TOOLS)];
    for (const role of ["OWNER", "STAFF", "REP", "DRIVER", "TECHNICIAN"] as const) {
      const names = agentToolNames(role);
      for (const r of readNames) {
        expect(names, `${role} should be able to read ${r}`).toContain(r);
      }
    }
  });

  it("narrows the write surface by role", () => {
    const owner = agentToolNames("OWNER").length;
    const driver = agentToolNames("DRIVER").length;
    expect(driver).toBeLessThan(owner);
    // A driver has delivery:log and task:manage but no money capability.
    expect(agentToolNames("DRIVER")).toContain("logDelivery");
    expect(agentToolNames("DRIVER")).not.toContain("applyLateFee");
    expect(agentToolNames("DRIVER")).not.toContain("returnRental");
  });

  it("counts every extra write tool as a mutation, so none bypasses the gate", () => {
    for (const name of [...Object.keys(EXTRA_WRITE_TOOLS), ...Object.keys(OPS_WRITE_TOOLS)]) {
      expect(MUTATING_TOOLS.has(name), `${name} must be gated`).toBe(true);
    }
  });

  it("marks no read tool as a mutation", () => {
    for (const name of [...Object.keys(EXTRA_READ_TOOLS), ...Object.keys(OPS_READ_TOOLS)]) {
      expect(MUTATING_TOOLS.has(name), `${name} must not be gated`).toBe(false);
    }
  });

  it("keeps tenantId out of every schema, including the expanded surface", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/agent/tools.extra.ts"), "utf8");
    // Look only at the declared input schemas, not the bodies (which legitimately
    // reference ctx.tenantId).
    const schemas = src.match(/inputSchema:\s*z\.object\(\{[\s\S]*?\}\)/g) ?? [];
    expect(schemas.length).toBeGreaterThan(10);
    for (const schema of schemas) {
      expect(schema).not.toMatch(/tenantId/);
    }
  });

  it("wires a tool to every core module that is meant to have one", () => {
    // Covered means actually imported by one of the tool registries — not
    // merely absent from a list, which is the check that lets coverage rot.
    const toolSources = [
      readFileSync(join(process.cwd(), "src/lib/agent/tools.ts"), "utf8"),
      readFileSync(join(process.cwd(), "src/lib/agent/tools.extra.ts"), "utf8"),
      readFileSync(join(process.cwd(), "src/lib/agent/tools.ops.ts"), "utf8"),
    ].join("\n");

    const uncovered = readdirSync(CORE_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((m) => !NOT_TOOL_SURFACE.has(m))
      .filter((m) => !toolSources.includes(`@/lib/core/${m}"`));

    // Anything here has no tool and no exemption — wire it up, or add it to
    // NOT_TOOL_SURFACE with a reason for why the agent shouldn't drive it.
    expect(uncovered, "core modules with neither a tool nor an exemption").toEqual([]);
  });

  it("can write to its own memory, not only read from it", () => {
    // loadFacts has fed every system prompt since memory shipped, and nothing
    // ever called rememberFact — so "what you already know about this
    // business" was permanently empty and the console's forget-a-fact button
    // had nothing to act on. A read-only memory is not a memory.
    const owner = agentToolNames("OWNER");
    expect(owner).toContain("rememberFact");
    expect(owner).toContain("forgetFact");
    expect(owner).toContain("recallFacts");
  });

  it("holds memory writes under the gate like any other write", () => {
    // It's low-stakes, but a workspace set to "nothing runs on its own" means
    // nothing — an exception carved out here is the start of carving others.
    expect(MUTATING_TOOLS.has("rememberFact")).toBe(true);
    expect(MUTATING_TOOLS.has("forgetFact")).toBe(true);
    expect(MUTATING_TOOLS.has("recallFacts")).toBe(false);
  });

  it("keeps the exemption list honest — nothing exempt is also wired up", () => {
    const toolSources = [
      readFileSync(join(process.cwd(), "src/lib/agent/tools.ts"), "utf8"),
      readFileSync(join(process.cwd(), "src/lib/agent/tools.extra.ts"), "utf8"),
      readFileSync(join(process.cwd(), "src/lib/agent/tools.ops.ts"), "utf8"),
    ].join("\n");

    // A module that is both exempt and imported means the list is stale and
    // is now hiding real modules behind an out-of-date claim.
    const contradictions = [...NOT_TOOL_SURFACE].filter((m) =>
      toolSources.includes(`@/lib/core/${m}"`)
    );
    expect(contradictions, "listed as exempt but actually wired up").toEqual([]);
  });
});
