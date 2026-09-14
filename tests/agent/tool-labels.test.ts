// Every action the agent can take has to be sayable in English.
//
// The progress list and the approval queue both render these, so a tool with
// no readable label shows a business owner `findItemByBarcode` at the exact
// moment they are deciding whether to let it move money.

import { describe, it, expect } from "vitest";
import { toolLabel, toolLabelProgressive } from "../../src/lib/agent/toolLabels";
import { agentToolNames } from "../../src/lib/agent/tools";

describe("toolLabel", () => {
  it("names the actions that stop for approval exactly", () => {
    expect(toolLabel("recordPayment")).toBe("Record a payment");
    expect(toolLabel("sendQuote")).toBe("Send a quote to the customer");
    expect(toolLabel("convertQuoteToInvoice")).toBe("Turn a quote into an invoice");
  });

  it("reads the verb out of a name it has never seen", () => {
    expect(toolLabel("listPurchaseOrders")).toBe("Look through purchase orders");
    expect(toolLabel("getTaxSummary")).toBe("Check tax summary");
    expect(toolLabel("markEmailRead")).toBe("Mark email read");
  });

  it("phrases work in progress as work in progress", () => {
    expect(toolLabelProgressive("findCustomers")).toBe("Looking up customers");
    expect(toolLabelProgressive("recordPayment")).toBe("Recording a payment");
    expect(toolLabelProgressive("getTaxSummary")).toBe("Checking tax summary");
  });

  it("never shows raw camelCase for any tool an owner can trigger", () => {
    // The property that matters, checked against the real registry rather
    // than a handful of examples — a tool added tomorrow is covered too.
    const raw = agentToolNames("OWNER").filter((name) => {
      const label = toolLabel(name);
      // A good label is sentence-cased and spaced; a bad one is the name back.
      return label === name || /[a-z][A-Z]/.test(label);
    });
    expect(raw, "tools with no readable label").toEqual([]);
  });

  it("starts every label with a capital", () => {
    for (const name of agentToolNames("OWNER")) {
      const label = toolLabel(name);
      expect(label[0], `${name} -> ${label}`).toBe(label[0].toUpperCase());
    }
  });
});
