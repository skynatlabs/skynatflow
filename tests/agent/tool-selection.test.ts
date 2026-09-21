// The eval suite for tool selection.
//
// Narrowing what we send the model is only safe if it never hides the tool
// the model needed. That is not a claim you make once — it is a claim that
// has to survive every new tool anybody adds, so it is asserted here on
// every build.
//
// Deliberately needs NO API key and makes no model call. Selection is pure
// code, so the property that matters — "the way in was offered" — is a
// property of that code and can be checked in milliseconds. A test that
// needed a provider key would be a test that never ran in CI, and this is
// exactly the test that must always run.
//
// Each case is phrased the way an owner actually types, not the way the tool
// is named. `anyOf` because most real questions have more than one honest
// way in: "who owes us money" is answered by whoToChase or overdueInvoices,
// and insisting on one would be testing our taste, not the behaviour.

import { describe, it, expect } from "vitest";
import { buildAgentTools, type AgentContext } from "../../src/lib/agent/tools";
import { capabilitiesOfBuiltIn } from "../../src/lib/core/access";
import {
  selectToolNames,
  scoreTools,
  CORE_TOOLS,
  MAX_TOOLS,
  terms,
} from "../../src/lib/agent/toolSelection";

const ctx: AgentContext = {
  tenantId: "t_eval",
  role: "OWNER",
  capabilities: capabilitiesOfBuiltIn("OWNER"),
  userId: "u_eval",
  membershipId: "m_eval",
  customerLabel: "customer",
  currency: "ZAR",
};

const ALL = buildAgentTools(ctx);

interface Case {
  text: string;
  anyOf: string[];
}

const CASES: Case[] = [
  // money in
  { text: "who owes us money?", anyOf: ["whoToChase", "overdueInvoices"] },
  { text: "what invoices are overdue", anyOf: ["overdueInvoices", "whoToChase"] },
  { text: "chase the late payers for me", anyOf: ["draftTheChase", "whoToChase", "chasingHistory"] },
  { text: "which quote should I chase first", anyOf: ["whichQuoteToChaseFirst"] },
  { text: "what is Naledi's balance", anyOf: ["customerBalance"] },
  { text: "record a payment of 5000 from Naledi Trading", anyOf: ["recordPayment"] },
  { text: "refund that customer 300", anyOf: ["recordRefund"] },
  { text: "ring up a cash sale of 250", anyOf: ["recordCashSale"] },
  { text: "charge them a late fee", anyOf: ["applyLateFee"] },
  { text: "set up a payment plan for them", anyOf: ["agreePaymentPlan", "paymentPlan"] },

  // quoting and selling
  { text: "create a quote for Peter for three pumps", anyOf: ["createQuote"] },
  { text: "send that quote to the customer", anyOf: ["sendQuote"] },
  { text: "turn the quote into an invoice", anyOf: ["convertQuoteToInvoice"] },
  { text: "draft a quote from this email", anyOf: ["draftQuoteFromText"] },
  { text: "which quotes have gone quiet", anyOf: ["findStaleDocuments", "whichQuoteToChaseFirst"] },
  { text: "how are sales looking", anyOf: ["salesHealth", "howAmIDoing"] },
  { text: "who should handle this new lead", anyOf: ["suggestSalesperson", "enquiries"] },

  // stock
  { text: "what stock is about to run out", anyOf: ["reorderSuggestions", "demandHeatmap"] },
  { text: "what is not selling", anyOf: ["demandHeatmap", "whatWillSell"] },
  { text: "do a stocktake", anyOf: ["recordStocktake"] },
  { text: "add a new product to the catalogue", anyOf: ["createProduct", "addProducts"] },
  { text: "change the price on that item", anyOf: ["repriceProduct", "updateProduct", "whereThePriceIsWrong"] },
  { text: "scan this barcode", anyOf: ["findItemByBarcode"] },
  { text: "are we losing stock", anyOf: ["shrinkageReport", "thingsThatLookWrong"] },

  // money out
  { text: "record a supplier bill", anyOf: ["recordSupplierBill"] },
  { text: "who do we owe our suppliers", anyOf: ["whoOwesWhatToSuppliers", "supplierBills"] },
  { text: "pay the supplier", anyOf: ["paySupplierBill", "buildPaymentRun"] },
  { text: "show me the purchase orders", anyOf: ["listPurchaseOrders"] },
  { text: "submit an expense for this slip", anyOf: ["submitExpense", "recordCost"] },
  { text: "approve the outstanding expenses", anyOf: ["approveExpense", "listExpenses"] },
  { text: "how is this cost coded", anyOf: ["howCostsAreCoded", "codeThisCost"] },
  { text: "have we been billed twice", anyOf: ["possibleDuplicateCosts", "markDuplicateCost"] },
  { text: "where can we save money", anyOf: ["consolidationSavings", "findCostRises"] },

  // books
  { text: "profit and loss for last month", anyOf: ["profitAndLoss"] },
  { text: "show me the balance sheet", anyOf: ["balanceSheet"] },
  { text: "trial balance please", anyOf: ["trialBalance"] },
  { text: "post a journal entry", anyOf: ["postJournalEntry"] },
  { text: "close the accounting period", anyOf: ["closeAccountingPeriod"] },
  { text: "month end pack", anyOf: ["monthEndPack"] },
  { text: "what does our cash look like over the next few months", anyOf: ["cashForecast", "cashFlowStatement"] },
  { text: "can we afford another bakkie", anyOf: ["canWeAffordIt", "howMuchCanWeAfford"] },

  // tax
  { text: "do the vat return", anyOf: ["vatReturn", "saveVatReturn", "vatFilingPack"] },
  { text: "how much tax are we sitting on", anyOf: ["taxPosition", "taxSummary"] },

  // people
  { text: "who is off today", anyOf: ["whoIsAway", "teamAttendance"] },
  { text: "I need to book leave", anyOf: ["requestLeave", "leaveBalances"] },
  { text: "approve that leave request", anyOf: ["decideLeave", "listLeaveRequests"] },
  { text: "how many hours did the team work this week", anyOf: ["weeklyTimesheet", "timesheet", "hoursOnAJob"] },
  { text: "clock me onto this job", anyOf: ["clockOntoJob"] },
  { text: "what will payroll cost next month", anyOf: ["payrollForecast"] },
  { text: "add someone to the team", anyOf: ["addSomebodyToTheTeam", "listMembers"] },
  { text: "how is the team performing", anyOf: ["teamPerformance", "howAmIDoing"] },

  // work and the field
  { text: "book a site visit for Tuesday morning", anyOf: ["scheduleAppointment", "putJobOnADay"] },
  { text: "what is on today", anyOf: ["todayPlan", "theDay"] },
  { text: "plan my day", anyOf: ["putTheDayInOrder", "todayPlan"] },
  { text: "raise a job card", anyOf: ["createJobCard"] },
  { text: "is this job over budget", anyOf: ["jobBudgets", "setJobBudget"] },
  { text: "put a checklist on that job", anyOf: ["putChecklistOnJob", "jobChecklist", "makeChecklist"] },
  { text: "which jobs have no proof of work", anyOf: ["jobsWithoutProof", "proofForJob"] },
  { text: "can we fit another job in this month", anyOf: ["canWeFitItIn"] },
  { text: "write a delivery note", anyOf: ["writeDeliveryNote"] },
  { text: "mark that as delivered", anyOf: ["markDelivered", "logDelivery"] },

  // fleet
  { text: "where have the vans been", anyOf: ["tripLog", "fleetOperations", "travelEfficiencyReport"] },
  { text: "start a trip", anyOf: ["startTrip"] },
  { text: "the fuel spend looks wrong", anyOf: ["fuelAnomalies", "logFuel"] },
  { text: "service the vehicle", anyOf: ["recordVehicleService", "maintenanceContracts"] },

  // conversations
  { text: "any important email today", anyOf: ["listInboundEmails", "mailThreads"] },
  { text: "reply to that message", anyOf: ["sendMailMessage", "readMessageThread"] },
  { text: "did we miss any calls", anyOf: ["missedCalls", "answerMissedCall"] },
  { text: "log a call with Naledi", anyOf: ["logACall"] },
  { text: "send them a whatsapp", anyOf: ["whatsappLink", "sendTeamMessage"] },
  { text: "send a broadcast to all customers", anyOf: ["planABroadcast", "broadcastsSent"] },
  { text: "are we allowed to contact them", anyOf: ["mayWeContact", "recordConsent", "consentAcrossTheList"] },
  { text: "who is waiting on a reply from me", anyOf: ["whoIsWaiting"] },

  // agreements
  { text: "write an agreement for this work", anyOf: ["writeAgreement", "agreementTemplates"] },
  { text: "send it for signature", anyOf: ["sendAgreementForSignature", "awaitingSignature"] },
  { text: "are we ready to bid on this tender", anyOf: ["tenderReadiness"] },

  // banking
  { text: "reconcile the bank account", anyOf: ["proposeBankMatches", "syncBankFeed", "reconciliationRules"] },
  { text: "import a bank statement", anyOf: ["importBankStatement"] },

  // compliance
  { text: "what licences are coming due", anyOf: ["listObligations", "complianceRadar"] },
  { text: "set up our compliance calendar", anyOf: ["setUpComplianceCalendar", "proposeComplianceCalendar"] },
  { text: "issue a certificate for that job", anyOf: ["issueCertificate", "certificates"] },

  // assets and property
  { text: "what is on the asset register", anyOf: ["assetRegister", "bookValues"] },
  { text: "run depreciation", anyOf: ["runDepreciation"] },
  { text: "who has the drill", anyOf: ["assetsHeldByPerson", "issueAsset"] },
  { text: "show me the properties", anyOf: ["listProperties"] },
  { text: "what rentals are out", anyOf: ["activeRentals", "returnRental"] },

  // local and misc
  { text: "when is load shedding", anyOf: ["powerSchedule", "setPowerSchedule"] },
  { text: "how do we compare to similar businesses", anyOf: ["howWeCompare"] },
  { text: "how am I doing", anyOf: ["howAmIDoing", "businessSnapshot"] },
  { text: "does anything look wrong", anyOf: ["thingsThatLookWrong"] },
  { text: "what is the agent costing us", anyOf: ["whatTheAgentCosts", "valueLedgerReport"] },
  { text: "record a donation", anyOf: ["recordDonation", "listDonations"] },
  { text: "any customer complaints", anyOf: ["customerComplaints", "settleComplaint"] },
  { text: "who should we ask for a review", anyOf: ["whoToAskForAReview"] },
  { text: "compare the branches", anyOf: ["compareBranches", "listBranches"] },
  { text: "set the exchange rate", anyOf: ["setExchangeRate", "foreignCurrencyPosition"] },
];

describe("tool selection", () => {
  it("offers every tool the whole surface has, before narrowing", () => {
    expect(Object.keys(ALL).length).toBeGreaterThan(300);
  });

  it("splits camelCase tool names into the words a person would type", () => {
    expect(terms("whoOwesWhatToSuppliers")).toEqual(["owe", "supplier"]);
    expect(terms("overdueInvoices")).toEqual(["overdue", "invoice"]);
  });

  it("always offers the core set, even for a request that matches nothing", () => {
    const offered = selectToolNames(ALL, { text: "zzzz qqqq" });
    for (const core of CORE_TOOLS) {
      expect(offered, `core tool ${core} must always be offered`).toContain(core);
    }
  });

  it("never offers more than the cap", () => {
    for (const { text } of CASES) {
      const offered = selectToolNames(ALL, { text });
      expect(offered.length, `"${text}" offered ${offered.length}`).toBeLessThanOrEqual(MAX_TOOLS);
    }
  });

  it("honours caller hints", () => {
    const offered = selectToolNames(ALL, { text: "hello", hints: ["runDepreciation"] });
    expect(offered).toContain("runDepreciation");
  });

  it("ignores hints for tools this role cannot use", () => {
    const offered = selectToolNames(ALL, { text: "hello", hints: ["notARealTool"] });
    expect(offered).not.toContain("notARealTool");
  });

  // The real test. Every case must keep a way in.
  describe("recall — the tool that answers the question is offered", () => {
    for (const { text, anyOf } of CASES) {
      it(`"${text}"`, () => {
        // Guard against a renamed tool silently making a case vacuous.
        for (const name of anyOf) {
          expect(ALL[name], `test refers to ${name}, which no longer exists`).toBeDefined();
        }

        const offered = selectToolNames(ALL, { text });
        const hit = anyOf.some((name) => offered.includes(name));

        if (!hit) {
          const ranked = scoreTools(ALL, text);
          const where = anyOf
            .map((name) => {
              const at = ranked.findIndex((r) => r.name === name);
              return `${name} ranked ${at === -1 ? "unscored" : `#${at + 1} (${ranked[at].score.toFixed(2)})`}`;
            })
            .join("; ");
          throw new Error(
            `none of [${anyOf.join(", ")}] was offered for "${text}".\n` +
              `  ${where}\n` +
              `  top 8: ${ranked.slice(0, 8).map((r) => r.name).join(", ")}`
          );
        }

        expect(hit).toBe(true);
      });
    }
  });
});
