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
