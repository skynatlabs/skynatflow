// The autonomy gate decides what software may do to a real business while
// nobody is watching. It is enforced in code, not in the prompt, so these
// test the decision function directly — a model that "decides" to send an
// invoice anyway still has to get past this.

import { describe, it, expect } from "vitest";
import { canAutoRun, isReadOnly, AUTONOMY_LABELS } from "../../src/lib/agent/autonomy";

const MONEY_OR_OUTBOUND = ["recordPayment", "recordRefund", "sendQuote", "convertQuoteToInvoice"];
const REVERSIBLE = [
  "createQuote",
  "createCustomer",
  "updateCustomerDetails",
  "createTask",
  "updateTaskStatus",
  "scheduleAppointment",
];

describe("reading is always allowed", () => {
  it("treats every non-write tool as read-only", () => {
    for (const t of ["findCustomers", "businessSnapshot", "customerHistory", "listProducts"]) {
      expect(isReadOnly(t), t).toBe(true);
    }
  });

  it("allows read tools at the most restrictive setting, unattended", () => {
    for (const t of ["findCustomers", "businessSnapshot"]) {
      expect(
        canAutoRun({ toolName: t, autonomy: "SUGGEST_ONLY", userPresent: false }).allowed,
        t
      ).toBe(true);
    }
  });
});

describe("money and outbound contact always stop for a person", () => {
  it("holds them unattended at EVERY autonomy level, including FULL", () => {
    for (const autonomy of ["SUGGEST_ONLY", "REVERSIBLE", "FULL"] as const) {
      for (const tool of MONEY_OR_OUTBOUND) {
        const verdict = canAutoRun({ toolName: tool, autonomy, userPresent: false });
        expect(verdict.allowed, `${tool} @ ${autonomy}`).toBe(false);
      }
    }
  });

  it("allows them when a person asked and is watching", () => {
    for (const tool of MONEY_OR_OUTBOUND) {
      expect(
        canAutoRun({ toolName: tool, autonomy: "SUGGEST_ONLY", userPresent: true }).allowed,
        tool
      ).toBe(true);
    }
  });

  it("explains why it held, so the approval screen can say something useful", () => {
    const verdict = canAutoRun({ toolName: "recordPayment", autonomy: "FULL", userPresent: false });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/money|customer/i);
  });
});

describe("reversible writes follow the dial", () => {
  it("blocks everything on SUGGEST_ONLY", () => {
    for (const tool of REVERSIBLE) {
      expect(
        canAutoRun({ toolName: tool, autonomy: "SUGGEST_ONLY", userPresent: false }).allowed,
        tool
      ).toBe(false);
    }
  });

  it("allows them on REVERSIBLE and FULL", () => {
    for (const autonomy of ["REVERSIBLE", "FULL"] as const) {
      for (const tool of REVERSIBLE) {
        expect(
          canAutoRun({ toolName: tool, autonomy, userPresent: false }).allowed,
          `${tool} @ ${autonomy}`
        ).toBe(true);
      }
    }
  });

  it("treats a draft quote as reversible but sending it as not", () => {
    const draft = canAutoRun({ toolName: "createQuote", autonomy: "REVERSIBLE", userPresent: false });
    const send = canAutoRun({ toolName: "sendQuote", autonomy: "REVERSIBLE", userPresent: false });
    expect(draft.allowed).toBe(true); // nothing has left the building
    expect(send.allowed).toBe(false); // this reaches the customer
  });
});

describe("labels", () => {
  it("has copy for every level, so the settings screen can't render blank", () => {
    for (const level of ["SUGGEST_ONLY", "REVERSIBLE", "FULL"] as const) {
      expect(AUTONOMY_LABELS[level]).toBeTruthy();
    }
  });
});

// The guard that found the hole this test now defends.
//
// The gate classifies by two hand-written lists. A mutating tool in neither
// falls through to "reversible" and runs unattended at FULL autonomy — which
// is correct for most writes and quietly wrong for the ones that move money
// or speak to a customer. Seven tools were in that position, including one
// that charges a late fee and one that emails a donor a tax receipt.
//
// Nobody will remember this file when adding the next tool, so the check is
// by shape: a mutating tool whose NAME reads like money or outbound contact
// must be classified deliberately.
describe("no money or contact tool slips the gate", () => {
  // Deliberately blunt. A false positive costs one line in the allow-list
  // below and a moment's thought; a false negative costs a customer being
  // charged by a machine nobody asked.
  const MONEY_OR_CONTACT = /^(send|pay|issue|charge|refund|broadcast|post(Journal|History)|apply(LateFee)|approve|record(Payment|Refund|CashSale|Donation|TheChase))/;

  /**
   * Names that match the pattern but genuinely neither move money nor speak
   * to anybody outside the business. Each needs a reason.
   */
  const NOT_ACTUALLY_RISKY: Record<string, string> = {
    answerMissedCall: "Writes the wording and records nothing — the speaking is still a person's.",
    sendTeamMessage: "Internal. Colleagues, not customers.",
    rejectExpense: "Refusing a claim spends nothing and tells nobody outside.",
    submitExpense: "A staff member claiming; approval is the gate and it is held.",
    applyCustomerDetailsCorrection: "Edits a customer record. Reversible, and nothing leaves.",
    applyIndustryPack: "Seeds a chart of accounts and a starter catalogue. Internal setup.",
    issueAsset: "Hands a drill to a colleague. Internal.",
  };

  it("classifies every money- or contact-shaped write deliberately", async () => {
    const { MUTATING_TOOLS, buildAgentTools } = await import("../../src/lib/agent/tools");
    const { capabilitiesOfBuiltIn } = await import("../../src/lib/core/access");

    const tools = buildAgentTools({
      tenantId: "t_gate",
      role: "OWNER",
      capabilities: capabilitiesOfBuiltIn("OWNER"),
      userId: "u_gate",
      membershipId: "m_gate",
      customerLabel: "customer",
      currency: "ZAR",
    });

    const slipped = Object.keys(tools).filter((name) => {
      if (!MUTATING_TOOLS.has(name)) return false;
      if (!MONEY_OR_CONTACT.test(name)) return false;
      if (name in NOT_ACTUALLY_RISKY) return false;
      // Would it run with nobody watching, at the most permissive setting?
      return canAutoRun({ toolName: name, autonomy: "FULL", userPresent: false, isMutation: true }).allowed;
    });

    expect(
      slipped,
      `These write, read like money or outbound contact, and would run unattended at FULL. ` +
        `Add each to ALWAYS_ASK in src/lib/agent/autonomy.ts, or to NOT_ACTUALLY_RISKY here with ` +
        `a reason it is neither.`
    ).toEqual([]);
  });
});
