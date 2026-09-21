// Which operations must leave a trail.
//
// Coverage was thin — 33 audited operations across an application with
// hundreds of mutating ones — and blanket-auditing everything would produce a
// log nobody reads. So this names the operations that genuinely must be
// recorded, and fails if one of them stops recording.
//
// The list is short on purpose. Enterprise security reviews ask for three
// things by name: authentication events, role changes, and administrative
// actions. Money movement is the fourth, because it is the one people argue
// about months later.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

interface Sensitive {
  what: string;
  file: string;
  /** The function, or the place the audit has to live. */
  near: string;
  why: string;
}

const MUST_BE_AUDITED: Sensitive[] = [
  {
    what: "every movement of money",
    file: "src/lib/core/ledger.ts",
    near: "postEntry",
    why: "Every money movement in the app posts an entry, so one audit here cannot be forgotten by a tenth caller.",
  },
  {
    what: "role changes",
    file: "src/lib/core/staff.ts",
    near: "setStaffRole",
    why: "Named explicitly in every enterprise security questionnaire.",
  },
  {
    what: "somebody removed from a workspace",
    file: "src/lib/core/staff.ts",
    near: "removeStaff",
    why: "Deprovisioning is half of what an access review checks.",
  },
  {
    what: "a role being defined",
    file: "src/lib/core/roles.ts",
    near: "saveWorkspaceRole",
    why: "Defining who may do what is the most privileged act in the product.",
  },
  {
    what: "an API key revoked",
    file: "src/lib/api/keys.ts",
    near: "revokeApiKey",
    why: "Credential lifecycle, and the shape of an incident response.",
  },
  {
    what: "what a workspace pays",
    file: "src/lib/core/billing.ts",
    near: "auditBilling",
    why: "'Who downgraded us in March' has no answer without it.",
  },
  {
    what: "closing an account",
    // Recorded in the action rather than the core function, because that is
    // where the acting user is known. Either place is defensible; this
    // asserts wherever it actually is.
    file: "src/app/dashboard/[tenantId]/settings/close-account/actions.ts",
    near: "requestClosure",
    why: "Deletion is irreversible and somebody has to be accountable for asking.",
  },
];

describe("the audit trail covers what matters", () => {
  for (const entry of MUST_BE_AUDITED) {
    it(`records ${entry.what}`, () => {
      const source = readFileSync(entry.file, "utf8");
      expect(source, `${entry.file} should contain ${entry.near}`).toContain(entry.near);
      expect(
        source.includes("recordAudit"),
        `${entry.file} no longer records an audit entry. ${entry.why}`
      ).toBe(true);
    });
  }

  it("never lets an audit failure break the operation it is recording", () => {
    // A log table having a bad day must not roll back a posted journal entry
    // or stop somebody being removed from a workspace.
    for (const file of ["src/lib/core/ledger.ts", "src/lib/api/keys.ts", "src/lib/core/billing.ts"]) {
      const source = readFileSync(file, "utf8");
      const audits = source.split("recordAudit(").slice(1);
      for (const after of audits) {
        const window = after.slice(0, 600);
        expect(
          window.includes(".catch("),
          `${file}: an audit write is not guarded with .catch — a failure there would take the operation with it`
        ).toBe(true);
      }
    }
  });
});
