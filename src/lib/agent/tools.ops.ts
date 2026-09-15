// The last of the Business Graph: catalog, till, fleet, wholesale, team chat,
// membership and document templates.
//
// With this file, every core module that represents something a person can do
// in the app is reachable by the agent. tests/agent/coverage.test.ts enforces
// that — a new core module with no tool and no written exemption fails CI.
//
// Same invariants as the other two registries: no tenantId in any schema, and
// every tool calls the same src/lib/core/* function the dashboard calls.

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Capability } from "@/lib/core/access";
import type { AgentContext } from "@/lib/agent/tools";

import {
  createProduct,
  updateProduct,
  setProductActive,
  searchProducts,
} from "@/lib/core/catalog";
import { openTill, findItemByBarcode } from "@/lib/core/pos";
import { logFuel, getFuelAnomalies } from "@/lib/core/fuel";
import { PartyRole, TripPurpose, TripStatus } from "@prisma/client";
import { startTrip, endTrip, addStop, listTrips, getTrip } from "@/lib/core/trips";
import {
  assetCosts,
  fleetCost,
  jobMargins,
  customerMargins,
  laneMargins,
  lastDays,
  setCostRate,
  setAssetCapacity,
} from "@/lib/core/costing";
import { captureLedger } from "@/lib/core/captureLedger";
import { travelSummary } from "@/lib/core/travelEfficiency";
import { consolidationReport, EFFORT_LABEL } from "@/lib/core/consolidation";
import { valueSummary } from "@/lib/core/valueLedger";
import { submitExpense, markDuplicate, keepBoth, possibleDuplicates } from "@/lib/core/expenses";
import { cashFlowStatement } from "@/lib/core/cashFlowStatement";
import { accrueExpense, deferRevenue, listAccruals } from "@/lib/core/accruals";
import { runMonthlyDepreciation, bookValues } from "@/lib/core/depreciation";
import { setDocumentCurrency, foreignDocuments } from "@/lib/core/documentCurrency";
import { taxProvisions, vatSetAside } from "@/lib/core/taxProvisions";
import { monthEndPack, nextMonthToClose } from "@/lib/core/bookkeeper";
import {
  detentionOwed, billDetention, unbilledRecoverables, billRecoverables, setRecoverable,
  emptyRunning, fuelConsumption, maintenanceDue, recordService, setServicePlan,
  consumablesByAsset, checkLoad, setStopLoad, subcontractorsAtRisk,
  reportIncident, addToIncident, incidentPack, listIncidents, routeDeviations,
} from "@/lib/core/fleetOps";
import { winRate, readingNotAnswering, quietCustomers, discountLeak } from "@/lib/core/salesHealth";
import { packFor, setTurnaroundMode } from "@/lib/core/industryPacks";
import { tenderReadiness } from "@/lib/agent/officers/legal";
import { sharedMemory } from "@/lib/agent/observations";
import { find } from "@/lib/core/find";
import { firstAudit } from "@/lib/agent/arrival";
import { listConnectionsForTenant } from "@/lib/core/connections";
import { listThreadsForMember, sendMessage, listMessages } from "@/lib/core/messaging";
import {
  listProposalTemplates,
  createProposalTemplate,
} from "@/lib/core/templates";
import {
  listActiveInvolvements,
  checkMembershipRenewals,
  recordDonation,
  listDonations,
  totalDonationsByFund,
} from "@/lib/core/nonprofit";
import { listPdfTemplates, setDefaultPdfTemplate } from "@/lib/core/pdfTemplates";
import { listAvailableSlots } from "@/lib/core/booking";
import { listEmailAccounts, listInboundEmails, markEmailRead } from "@/lib/core/email";
import { prisma } from "@/lib/db";
import { composeQuoteFromText } from "@/lib/core/quoteComposer";
import { buildWhatsAppShareLink, quoteWhatsAppMessage, invoiceWhatsAppMessage } from "@/lib/core/whatsappShare";
import {
  obligationRadar,
  listObligations,
  addObligation,
  completeObligation,
  waiveObligation,
  rescheduleObligation,
} from "@/lib/core/obligations";
import {
  buildCalendarFromLibrary,
  templatesFor,
  jurisdictionStatus,
  adoptFromDocument,
} from "@/lib/core/obligationLibrary";
import { researchJurisdiction, readObligationFromDocument } from "@/lib/ai/jurisdiction";
import { findCostRises, applySuggestedPrice } from "@/lib/core/repricing";
import { supplierPerformance } from "@/lib/core/supplierPerformance";
import { spendSplit, unclassifiedExpenses, classifyExpense } from "@/lib/core/expenses";
import {
  closePeriod,
  ensureChartOfAccounts,
  listAccounts,
  listClosedPeriods,
  postEntry,
  reverseEntry,
} from "@/lib/core/ledger";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/core/financialReports";
import { backfillLedger, ledgerCoverage } from "@/lib/core/ledgerBackfill";
import { listBankAccounts, importStatement, reconciliationGap } from "@/lib/core/banking";
import {
  createAsset,
  issueAsset,
  returnAsset,
  listAssets,
  assetSummary,
  assetsHeldBy,
} from "@/lib/core/assets";
import {
  requestLeave,
  decideLeave,
  leaveBalances,
  whoIsAway,
  listLeaveRequests,
  addEmploymentRecord,
  listEmploymentRecords,
} from "@/lib/core/people";
import { buildHandoverPack } from "@/lib/core/handover";
import {
  createAgreement,
  previewClaim,
  raiseClaim,
  agreementPositions,
  retentionHeld,
} from "@/lib/core/progressBilling";
import { compareBranches, listBranches, createBranch } from "@/lib/core/branches";
import { DOCUMENT_LANGUAGES } from "@/lib/core/documentLanguage";
import { applyProposal, upsertParties, upsertProducts } from "@/lib/onboarding/apply";
import { listIntakeDocuments, onboardingState } from "@/lib/onboarding/progress";
import { createDeliveryNote, listDeliveryNotes, markDelivered } from "@/lib/core/deliveryNotes";
import {
  proposeMatches,
  acceptMatch,
  ignoreLine,
  recordOverrule,
  listRules,
} from "@/lib/core/reconciliation";

export interface OpsToolDef {
  capability?: Capability;
  build: (ctx: AgentContext) => ToolSet[string];
}

// ------------------------------------------------------------------ reading

export const OPS_READ_TOOLS: Record<string, OpsToolDef> = {
  // The single most valuable read in the product for a business that is
  // otherwise fine. Everything here is a date somebody already agreed to;
  // what the agent adds is noticing before it is a crisis, and being able
  // to say what the crisis would actually be.
  complianceRadar: {
    build: (ctx) =>
      tool({
        description:
          "Everything this business owes somebody by a date: statutory filings, licences, " +
          "certificates, tax returns, insurance, contract notice windows and document expiries. " +
          "Returns what is overdue, due now, coming up, and what has lapsed badly enough to stop " +
          "work. Use this whenever asked what needs attention, what is due, whether anything is " +
          "slipping, or before promising work that depends on a person or vehicle being legal.",
        inputSchema: z.object({}),
        execute: async () => {
          const radar = await obligationRadar(ctx.tenantId);
          const strip = (l: (typeof radar.overdue)[number]) => ({
            id: l.id,
            title: l.title,
            kind: l.kind,
            authority: l.authority,
            actionBy: l.actionByAt.toISOString().slice(0, 10),
            dueOn: l.dueAt.toISOString().slice(0, 10),
            daysUntil: l.daysUntil,
            severity: l.severity,
            // Quoted verbatim rather than paraphrased: this sentence is why
            // anybody acts, and a rewrite of it is usually weaker.
            consequence: l.consequence,
            stopsWork: l.blocksWork,
            about: l.subject ? `${l.subject.type}: ${l.subject.label}` : null,
          });
          return {
            summary: radar.summary,
            overdue: radar.overdue.map(strip),
            dueToday: radar.due.map(strip),
            comingUp: radar.soon.map(strip),
            stoppingWorkNow: radar.blocking.map(strip),
            laterCount: radar.scheduled.length,
          };
        },
      }),
  },

  // Margin erosion is invisible because both halves of it are correct: the
  // catalogue cost was right when it was typed, and the purchase order is
  // right about what was paid. Only the comparison is news.
  findCostRises: {
    build: (ctx) =>
      tool({
        description:
          "Find products the business now pays more for than its catalogue says, so the margin " +
          "being reported is higher than the margin actually being earned. Returns the true " +
          "margin, the reported one, and the price that would restore the margin the item was " +
          "originally priced at. Use when asked about margins, pricing, whether costs are eating " +
          "into profit, or what to put prices up on.",
        inputSchema: z.object({
          minMovePercent: z
            .number()
            .optional()
            .describe("Ignore cost moves smaller than this. Defaults to 2%."),
        }),
        execute: async ({ minMovePercent }) => {
          const report = await findCostRises(ctx.tenantId, { minMovePercent });
          return {
            summary: report.summary,
            caveats: report.caveats,
            items: report.lines.slice(0, 25).map((l) => ({
              itemId: l.itemId,
              name: l.name,
              sellingFor: l.unitPriceCents / 100,
              catalogueCost: l.catalogueCostCents / 100,
              actuallyPaying: l.latestPaidCents / 100,
              marginReported: l.marginAssumedPercent,
              marginActual: l.marginNowPercent,
              suggestedPrice: l.suggestedPriceCents / 100,
              sellingAtALoss: l.sellingAtALoss,
            })),
            totalFound: report.lines.length,
          };
        },
      }),
  },

  supplierPerformance: {
    build: (ctx) =>
      tool({
        description:
          "How each supplier actually behaves: how long they usually take, their worst delivery, " +
          "how much has been spent with them, whether their prices have crept up, and orders " +
          "sent that were never received. Use when asked about suppliers, late deliveries, or " +
          "where costs are rising.",
        inputSchema: z.object({}),
        execute: async () => {
          const report = await supplierPerformance(ctx.tenantId);
          return {
            summary: report.summary,
            caveats: report.caveats,
            suppliers: report.suppliers.map((s) => ({
              supplierId: s.supplierId,
              name: s.name,
              ordersPlaced: s.ordersPlaced,
              outstanding: s.outstanding,
              usualLeadDays: s.medianLeadDays,
              worstLeadDays: s.worstLeadDays,
              totalSpent: s.totalSpentCents / 100,
              priceDriftPercent: s.priceDriftPercent,
              flags: s.flags,
            })),
          };
        },
      }),
  },

  // The reads the agent has never been able to do. Until the ledger existed
  // it could say who owed what; it could not say whether the business made
  // anything, which is the question owners actually ask.
  profitAndLoss: {
    build: (ctx) =>
      tool({
        description:
          "Whether the business made money over a period: income, cost of sales, gross margin, " +
          "overheads and what was left. Use for any question about profit, whether they can " +
          "afford something, how a month or year went, or why it went that way.",
        inputSchema: z.object({
          from: z.string().optional().describe("Start of the period, YYYY-MM-DD. Defaults to 1 January this year."),
          to: z.string().optional().describe("End of the period, YYYY-MM-DD. Defaults to today."),
        }),
        execute: async ({ from, to }) => {
          const pl = await profitAndLoss(ctx.tenantId, {
            from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
            to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
          });
          const rands = (c: number) => c / 100;
          return {
            summary: pl.summary,
            from: pl.from.toISOString().slice(0, 10),
            to: pl.to.toISOString().slice(0, 10),
            income: rands(pl.income.totalCents),
            costOfSales: rands(pl.costOfSales.totalCents),
            grossProfit: rands(pl.grossProfitCents),
            grossMarginPercent: pl.grossMarginPercent,
            overheads: rands(pl.expenses.totalCents),
            netProfit: rands(pl.netProfitCents),
            biggestExpenses: pl.expenses.rows
              .slice()
              .sort((a, b) => b.balanceCents - a.balanceCents)
              .slice(0, 8)
              .map((r) => ({ account: r.name, amount: rands(r.balanceCents) })),
          };
        },
      }),
  },

  balanceSheet: {
    build: (ctx) =>
      tool({
        description:
          "What the business owns and owes at a moment, and the owner's stake. Use for questions " +
          "about net worth, solvency, what is owed to and by the business, or before advising on " +
          "borrowing.",
        inputSchema: z.object({ at: z.string().optional().describe("Date, YYYY-MM-DD. Defaults to today.") }),
        execute: async ({ at }) => {
          const bs = await balanceSheet(
            ctx.tenantId,
            at ? new Date(`${at}T23:59:59.999Z`) : undefined
          );
          return {
            at: bs.to.toISOString().slice(0, 10),
            owns: bs.totalAssetsCents / 100,
            owes: bs.totalLiabilitiesCents / 100,
            ownersStake: bs.totalEquityCents / 100,
            profitThisYear: bs.retainedThisYearCents / 100,
            // Reported rather than assumed. If this is ever false something
            // wrote to the tables behind the application.
            balanced: bs.balanced,
            assets: bs.assets.rows.map((r) => ({ account: r.name, amount: r.balanceCents / 100 })),
            liabilities: bs.liabilities.rows.map((r) => ({ account: r.name, amount: r.balanceCents / 100 })),
          };
        },
      }),
  },

  trialBalance: {
    build: (ctx) =>
      tool({
        description:
          "Every account with a balance, in debit and credit columns. This is what a bookkeeper " +
          "or accountant asks for. Use when preparing a handover or checking the books add up.",
        inputSchema: z.object({ at: z.string().optional() }),
        execute: async ({ at }) => {
          const tb = await trialBalance(ctx.tenantId, at ? new Date(`${at}T23:59:59.999Z`) : undefined);
          return {
            balanced: tb.balanced,
            totalDebits: tb.totalDebitCents / 100,
            totalCredits: tb.totalCreditCents / 100,
            rows: tb.rows.map((r) => ({
              code: r.code,
              account: r.name,
              debit: r.debitBalanceCents / 100,
              credit: r.creditBalanceCents / 100,
            })),
          };
        },
      }),
  },

  chartOfAccounts: {
    build: (ctx) =>
      tool({
        description:
          "The accounts this business posts to. Read this before posting a journal entry so the " +
          "right account codes are used rather than invented.",
        inputSchema: z.object({}),
        execute: async () => {
          const accounts = await listAccounts(ctx.tenantId, { activeOnly: true });
          return {
            count: accounts.length,
            accounts: accounts.map((a) => ({
              code: a.code,
              name: a.name,
              type: a.type,
              subtype: a.subtype,
            })),
          };
        },
      }),
  },

  booksCoverage: {
    build: (ctx) =>
      tool({
        description:
          "How much of the business has actually reached the books, and what has not been posted " +
          "yet. Check this before quoting a profit figure — a profit and loss built on half the " +
          "invoices is worse than no figure at all.",
        inputSchema: z.object({}),
        execute: async () => {
          const [coverage, closed] = await Promise.all([
            ledgerCoverage(ctx.tenantId),
            listClosedPeriods(ctx.tenantId),
          ]);
          return {
            ...coverage,
            closedMonths: closed.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
          };
        },
      }),
  },

  // The read this whole arc exists for. An agent is better at this than a
  // person for one unglamorous reason: it will consider four hundred
  // candidates for one line, and nobody reconciling on a Friday afternoon
  // will.
  proposeBankMatches: {
    build: (ctx) =>
      tool({
        description:
          "Go through unreconciled bank statement lines and say what each one looks like, with a " +
          "confidence and a plain-language reason. Proposals only — never apply them without " +
          "showing the owner and getting a yes. Use when asked to reconcile, to explain the bank " +
          "account, or what a payment was.",
        inputSchema: z.object({
          bankAccountId: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }),
        execute: async ({ bankAccountId, limit }) => {
          const result = await proposeMatches(ctx.tenantId, { bankAccountId, limit });
          return {
            summary: result.summary,
            nothingMatches: result.unexplained,
            lines: result.proposals.map((p) => ({
              bankTransactionId: p.bankTransactionId,
              on: p.postedOn.toISOString().slice(0, 10),
              description: p.description,
              amount: p.amountCents / 100,
              bestMatch: p.best
                ? {
                    kind: p.best.kind,
                    targetId: p.best.id,
                    label: p.best.label,
                    confidence: p.best.confidence,
                    // Quoted to the owner as-is: a percentage is not
                    // checkable, a reason is.
                    why: p.best.reasons,
                  }
                : null,
              otherOptions: p.alternatives.map((a) => ({
                kind: a.kind,
                targetId: a.id,
                label: a.label,
                confidence: a.confidence,
              })),
            })),
          };
        },
      }),
  },

  bankAccounts: {
    build: (ctx) =>
      tool({
        description:
          "The bank accounts on this workspace and how far each one is from the books — how many " +
          "statement lines are still unexplained and what they add up to.",
        inputSchema: z.object({}),
        execute: async () => {
          const accounts = await listBankAccounts(ctx.tenantId);
          return {
            accounts: await Promise.all(
              accounts.map(async (a) => ({
                bankAccountId: a.id,
                name: a.name,
                last4: a.last4,
                postsTo: a.account.name,
                ...(await reconciliationGap(ctx.tenantId, a.id).then((g) => ({
                  unmatched: g.unmatched,
                  matched: g.matched,
                  unexplained: g.unexplainedCents / 100,
                }))),
              }))
            ),
          };
        },
      }),
  },

  reconciliationRules: {
    build: (ctx) =>
      tool({
        description:
          "What this business has taught the matcher by correcting it — which descriptions go to " +
          "which account. Read before proposing, so a known answer is used rather than guessed at.",
        inputSchema: z.object({}),
        execute: async () => {
          const rules = await listRules(ctx.tenantId);
          return {
            rules: rules.map((r) => ({
              matches: r.matchText,
              account: r.account.name,
              usedTimes: r.timesApplied,
              overruledTimes: r.timesOverruled,
            })),
          };
        },
      }),
  },

  retentionHeld: {
    build: (ctx) =>
      tool({
        description:
          "How much of this business's money customers are holding back as retention on progress " +
          "jobs, and how much of that is on work already finished. Almost no operator can answer " +
          "this and it is frequently more than a month's profit.",
        inputSchema: z.object({}),
        execute: async () => {
          const [held, positions] = await Promise.all([
            retentionHeld(ctx.tenantId),
            agreementPositions(ctx.tenantId),
          ]);
          return {
            summary: held.summary,
            totalHeld: held.totalHeldCents / 100,
            onFinishedJobs: held.onCompleteJobsCents / 100,
            jobs: positions.map((p) => ({
              agreementId: p.agreementId,
              title: p.title,
              customer: p.customer,
              totalValue: p.totalValueCents / 100,
              percentComplete: p.percentComplete,
              stillToClaim: p.remainingCents / 100,
              retentionHeld: p.retentionHeldCents / 100,
              status: p.status,
            })),
          };
        },
      }),
  },

  previewProgressClaim: {
    build: (ctx) =>
      tool({
        description:
          "Work out what the next claim on a progress job is worth, without raising it. Claims " +
          "state cumulative completion — 60% means the job is 60% done in total, not 60% more " +
          "since last time — and this shows the resulting slice, the retention withheld and the " +
          "net to invoice.",
        inputSchema: z.object({
          agreementId: z.string(),
          percentComplete: z.number().min(0).max(100),
        }),
        execute: async ({ agreementId, percentComplete }) => {
          const b = await previewClaim({ tenantId: ctx.tenantId, agreementId, percentComplete });
          return {
            claimNumber: b.sequence,
            thisClaim: b.grossCents / 100,
            retentionWithheld: b.retentionCents / 100,
            toInvoiceNow: b.netCents / 100,
            retentionHeldAfterThis: b.retentionHeldToDateCents / 100,
          };
        },
      }),
  },

  compareBranches: {
    build: (ctx) =>
      tool({
        description:
          "Profit by branch over a period, with people and assets per branch. Money nobody has " +
          "tagged to a branch is reported on its own rather than spread — mention that figure, " +
          "because until it is assigned each branch's number is a floor rather than a total.",
        inputSchema: z.object({
          from: z.string().optional().describe("YYYY-MM-DD"),
          to: z.string().optional().describe("YYYY-MM-DD"),
        }),
        execute: async ({ from, to }) => {
          const c = await compareBranches(ctx.tenantId, {
            from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
            to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
          });
          const strip = (b: (typeof c.branches)[number]) => ({
            name: b.name,
            income: b.incomeCents / 100,
            grossProfit: b.grossProfitCents / 100,
            overheads: b.expensesCents / 100,
            netProfit: b.netProfitCents / 100,
            people: b.people,
            assets: b.assets,
          });
          return {
            summary: c.summary,
            branches: c.branches.map(strip),
            notAssigned: c.unassigned ? strip(c.unassigned) : null,
            caveats: c.caveats,
          };
        },
      }),
  },

  listBranches: {
    build: (ctx) =>
      tool({
        description: "The branches on this workspace.",
        inputSchema: z.object({}),
        execute: async () => ({ branches: await listBranches(ctx.tenantId) }),
      }),
  },

  customerLanguages: {
    build: () =>
      tool({
        description:
          "The languages documents and messages can go out in. Use when a customer would be " +
          "better served in their own language — set it on the customer and every quote, invoice " +
          "and statement to them follows.",
        inputSchema: z.object({}),
        execute: async () => ({
          languages: Object.entries(DOCUMENT_LANGUAGES).map(([code, name]) => ({ code, name })),
        }),
      }),
  },

  whoIsAway: {
    build: (ctx) =>
      tool({
        description:
          "Who is on approved leave over a date range. Check this before promising a customer a " +
          "date or committing someone to a job — it is the question this feature exists for.",
        inputSchema: z.object({
          from: z.string().describe("YYYY-MM-DD"),
          to: z.string().describe("YYYY-MM-DD"),
        }),
        execute: async ({ from, to }) => {
          const away = await whoIsAway(
            ctx.tenantId,
            new Date(`${from}T00:00:00.000Z`),
            new Date(`${to}T23:59:59.999Z`)
          );
          return {
            count: away.length,
            away: away.map((a) => ({
              name: a.name,
              kind: a.kind,
              from: a.startOn.toISOString().slice(0, 10),
              to: a.endOn.toISOString().slice(0, 10),
            })),
          };
        },
      }),
  },

  leaveBalances: {
    build: (ctx) =>
      tool({
        description:
          "Everyone's leave position: entitlement, days already taken, days approved but still " +
          "ahead, and what is left. Taken and booked are separate because they mean different " +
          "things when deciding whether to approve another request.",
        inputSchema: z.object({ year: z.number().int().optional() }),
        execute: async ({ year }) => ({ balances: await leaveBalances(ctx.tenantId, { year }) }),
      }),
  },

  listLeaveRequests: {
    build: (ctx) =>
      tool({
        description: "Leave requests, optionally filtered to those still waiting on a decision.",
        inputSchema: z.object({
          status: z.enum(["REQUESTED", "APPROVED", "DECLINED", "CANCELLED"]).optional(),
        }),
        execute: async ({ status }) => {
          const rows = await listLeaveRequests(ctx.tenantId, { status });
          return {
            requests: rows.map((r) => ({
              leaveRequestId: r.id,
              who: r.membership.user?.name ?? r.membership.user?.email ?? "Team member",
              kind: r.kind,
              from: r.startOn.toISOString().slice(0, 10),
              to: r.endOn.toISOString().slice(0, 10),
              days: r.days,
              status: r.status,
            })),
          };
        },
      }),
  },

  assetRegister: {
    build: (ctx) =>
      tool({
        description:
          "What equipment the business owns and who has it. Use for questions about tools, " +
          "laptops, phones or vehicles, and before somebody leaves.",
        inputSchema: z.object({
          status: z.enum(["IN_STOCK", "ISSUED", "IN_REPAIR", "LOST", "RETIRED"]).optional(),
        }),
        execute: async ({ status }) => {
          const [assets, summary] = await Promise.all([
            listAssets(ctx.tenantId, { status }),
            assetSummary(ctx.tenantId),
          ]);
          return {
            summary: summary.summary,
            counts: {
              total: summary.total,
              issued: summary.issued,
              inStock: summary.inStock,
              inRepair: summary.inRepair,
              lost: summary.lost,
            },
            valueAtCost: summary.valueAtCostCents / 100,
            withoutRecordedValue: summary.missingValue,
            assets: assets.map((a) => ({
              assetId: a.id,
              name: a.name,
              category: a.category,
              serial: a.serial,
              status: a.status,
              heldBy: a.holder?.user?.name ?? a.holder?.user?.email ?? null,
            })),
          };
        },
      }),
  },

  // The read that makes somebody leaving a solved problem rather than a
  // fortnight of remembering.
  handoverPack: {
    build: (ctx) =>
      tool({
        description:
          "What a person is still holding and what only they know: equipment in their name, open " +
          "quotes, unfinished jobs, customers nobody else has dealt with, leave already approved. " +
          "Built from what they actually touched, not from what they remember. Use when somebody " +
          "resigns, goes on long leave, or changes role.",
        inputSchema: z.object({ teamMemberId: z.string() }),
        execute: async ({ teamMemberId }) => {
          const pack = await buildHandoverPack({
            tenantId: ctx.tenantId,
            membershipId: teamMemberId,
          });
          return {
            who: pack.name,
            summary: pack.summary,
            blocking: pack.blockingCount,
            items: pack.items,
            // Stated so the pack is never presented as exhaustive.
            caveats: pack.caveats,
          };
        },
      }),
  },

  employmentRecords: {
    build: (ctx) =>
      tool({
        description:
          "Contracts, warnings, reviews and qualifications on file for a person, or for everyone. " +
          "Read-only here — these are evidence, and adding one is a separate, deliberate act.",
        inputSchema: z.object({ teamMemberId: z.string().optional() }),
        execute: async ({ teamMemberId }) => {
          const rows = await listEmploymentRecords(ctx.tenantId, teamMemberId);
          return {
            records: rows.map((r) => ({
              id: r.id,
              who: r.membership.user?.name ?? r.membership.user?.email ?? "Team member",
              kind: r.kind,
              title: r.title,
              on: r.effectiveOn.toISOString().slice(0, 10),
            })),
          };
        },
      }),
  },

  spendSplit: {
    build: (ctx) =>
      tool({
        description:
          "What the business spent, split into real business costs, money the owner took out for " +
          "themselves, and payments nobody has classified yet. Use when asked what it costs to " +
          "run the business, about profitability, or where the money goes — the unreviewed " +
          "figure is important context and should be mentioned, not hidden.",
        inputSchema: z.object({}),
        execute: async () => {
          const split = await spendSplit(ctx.tenantId);
          return {
            summary: split.summary,
            businessCosts: split.businessCents / 100,
            ownerDrawings: split.drawingsCents / 100,
            notYetSplit: split.unreviewedCents / 100,
            notYetSplitCount: split.unreviewedCount,
          };
        },
      }),
  },

  unclassifiedSpending: {
    build: (ctx) =>
      tool({
        description:
          "Payments not yet marked as a business cost or as the owner's own money. Read these, " +
          "classify the obvious ones with classifySpending, and ask about only the ones that are " +
          "genuinely ambiguous.",
        inputSchema: z.object({ limit: z.number().int().positive().max(50).optional() }),
        execute: async ({ limit }) => {
          const rows = await unclassifiedExpenses(ctx.tenantId, limit ?? 20);
          return {
            count: rows.length,
            payments: rows.map((r) => ({
              expenseId: r.id,
              description: r.descriptionText,
              amount: r.amountCents / 100,
              category: r.category,
              on: r.createdAt.toISOString().slice(0, 10),
            })),
          };
        },
      }),
  },

  listObligations: {
    build: (ctx) =>
      tool({
        description:
          "List obligations of one kind — for example every licence, or every contract renewal. " +
          "Use complianceRadar instead when the question is what needs attention.",
        inputSchema: z.object({
          kind: z
            .enum([
              "COMPLIANCE_FILING",
              "LICENCE",
              "CERTIFICATE",
              "TAX",
              "INSURANCE",
              "CONTRACT",
              "WARRANTY",
              "DOCUMENT",
            ])
            .optional(),
          includeCompleted: z.boolean().optional(),
        }),
        execute: async ({ kind, includeCompleted }) => {
          const rows = await listObligations(ctx.tenantId, {
            kind,
            includeDone: includeCompleted ?? false,
          });
          return {
            count: rows.length,
            obligations: rows.map((o) => ({
              id: o.id,
              title: o.title,
              kind: o.kind,
              authority: o.authority,
              reference: o.reference,
              dueOn: o.dueAt.toISOString().slice(0, 10),
              recurrence: o.recurrence,
              severity: o.severity,
              status: o.status,
            })),
          };
        },
      }),
  },

  // Proposing the calendar is a read, deliberately. The agent works out what
  // this business owes and says so; writing it is a separate, approved step.
  // Reads the shared library for wherever this business actually is. Nothing
  // here knows the name of a single filing — that is the point.
  proposeComplianceCalendar: {
    build: () =>
      tool({
        description:
          "Work out which legal and regulatory obligations this business has, based on where it " +
          "is registered and what it does. Reads the shared jurisdiction library, so it works " +
          "for any country. Returns a proposal to show the owner — call setUpComplianceCalendar " +
          "to actually create them.",
        inputSchema: z.object({
          countryCode: z.string().describe("ISO 3166-1 alpha-2 country code, e.g. ZA, US, GB."),
          regionCode: z
            .string()
            .optional()
            .describe("State or province code, where it changes what the business owes."),
          isCompany: z.boolean().describe("A registered company rather than trading in a personal name."),
          isVatRegistered: z.boolean().describe("Registered for VAT, GST or equivalent sales tax."),
          hasEmployees: z.boolean(),
          hasVehicles: z.boolean(),
          registrationMonth: z.number().int().min(1).max(12).optional(),
        }),
        execute: async (profile) => {
          const templates = await templatesFor(profile);
          const status = await jurisdictionStatus(profile.countryCode, profile.regionCode);
          return {
            jurisdiction: `${status.countryCode}${status.regionCode ? `/${status.regionCode}` : ""}`,
            knownForThisPlace: status.templateCount,
            // Said plainly rather than hidden: an empty library is a real
            // answer, and the fix is a document upload or a research pass.
            libraryNote: status.note,
            count: templates.length,
            proposed: templates.map((t) => ({
              title: t.title,
              authority: t.authority,
              kind: t.kind,
              recurrence: t.recurrence,
              severity: t.severity,
              consequence: t.consequence,
              learnedFrom: t.source,
            })),
          };
        },
      }),
  },

  jurisdictionCoverage: {
    build: () =>
      tool({
        description:
          "How much the shared library knows about a country or state. Use before promising a " +
          "complete compliance calendar for somewhere new.",
        inputSchema: z.object({
          countryCode: z.string(),
          regionCode: z.string().optional(),
        }),
        execute: async ({ countryCode, regionCode }) => jurisdictionStatus(countryCode, regionCode),
      }),
  },

  // "Convert the quotation for Mr Isaac" and "quote 4F2B from yesterday" are
  // how people refer to documents out loud. Without a way to resolve that
  // phrasing to a row, every such request needed the person to go and find
  // the id themselves — which is the opposite of being able to just ask.
  findDocuments: {
    build: (ctx) =>
      tool({
        description:
          "Find quotes or invoices the way a person refers to them out loud: by who they are " +
          "for, by their reference, by roughly when they went out, or by amount. Use this " +
          "FIRST whenever someone names a document in words rather than giving you an id. " +
          "If more than one plausibly matches, ask which — never pick.",
        inputSchema: z.object({
          customerName: z.string().optional().describe("all or part of the customer's name"),
          type: z.enum(["QUOTE", "INVOICE"]).optional(),
          status: z
            .enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "PAID", "PARTIALLY_PAID", "OVERDUE"])
            .optional(),
          reference: z
            .string()
            .optional()
            .describe("a reference the person quoted, e.g. '365' or '4F2B' — matched loosely"),
          withinDays: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("only documents raised in the last N days ('yesterday' = 2)"),
          limit: z.number().int().min(1).max(25).optional().default(10),
        }),
        execute: async ({ customerName, type, status, reference, withinDays, limit }) => {
          const rows = await prisma.transaction.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: type ?? { in: ["QUOTE", "INVOICE"] },
              ...(status ? { status } : {}),
              ...(customerName
                ? { party: { name: { contains: customerName, mode: "insensitive" } } }
                : {}),
              ...(withinDays
                ? { createdAt: { gte: new Date(Date.now() - withinDays * 86_400_000) } }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: reference ? 200 : limit,
            select: {
              id: true,
              type: true,
              status: true,
              amountCents: true,
              subject: true,
              poNumber: true,
              createdAt: true,
              party: { select: { name: true } },
            },
          });

          // A quoted reference is matched after the query rather than in it:
          // people say "365" meaning the tail of an id, the PO number, or
          // the subject, and one SQL predicate can't cover all three.
          const needle = reference?.replace(/[^a-z0-9]/gi, "").toLowerCase();
          const matched = needle
            ? rows
                .filter((r) => {
                  const hay = [r.id, r.poNumber ?? "", r.subject ?? ""]
                    .join(" ")
                    .replace(/[^a-z0-9]/gi, "")
                    .toLowerCase();
                  return hay.includes(needle);
                })
                .slice(0, limit)
            : rows;

          return {
            documents: matched.map((r) => ({
              id: r.id,
              reference: r.id.slice(-6).toUpperCase(),
              type: r.type,
              status: r.status,
              customer: r.party.name,
              amountCents: r.amountCents,
              subject: r.subject,
              raisedAt: r.createdAt.toISOString(),
            })),
            note:
              matched.length === 0
                ? "Nothing matched. Ask them to say which customer it was for."
                : matched.length > 1
                  ? "More than one matched — ask which one they mean before acting."
                  : undefined,
          };
        },
      }),
  },

  whatsappLink: {
    build: (ctx) =>
      tool({
        description:
          "Build a click-to-chat WhatsApp link for a quote or invoice, opening a conversation " +
          "with that customer's saved number and a message containing the document link. " +
          "Give this to the user to click — it opens their own WhatsApp, so the message comes " +
          "from them personally rather than from a business number.",
        inputSchema: z.object({
          documentId: z.string().describe("a quote or invoice id from findDocuments"),
        }),
        execute: async ({ documentId }) => {
          const doc = await prisma.transaction.findFirst({
            where: { id: documentId, tenantId: ctx.tenantId },
            select: {
              id: true,
              type: true,
              amountCents: true,
              party: { select: { name: true, phone: true, portalToken: true } },
              tenant: { select: { name: true } },
            },
          });
          if (!doc) throw new Error("Document not found.");
          if (!doc.party.phone) {
            return { link: null, note: `${doc.party.name} has no phone number saved.` };
          }

          const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
          const path = doc.type === "INVOICE" ? "invoices" : "quotes";
          const viewUrl = `${base}/portal/${doc.party.portalToken}/${path}/${doc.id}`;
          const amountLabel = `R${(doc.amountCents / 100).toFixed(2)}`;

          const message =
            doc.type === "INVOICE"
              ? invoiceWhatsAppMessage({
                  tenantName: doc.tenant.name,
                  customerName: doc.party.name,
                  amountLabel,
                  viewUrl,
                })
              : quoteWhatsAppMessage({
                  tenantName: doc.tenant.name,
                  customerName: doc.party.name,
                  amountLabel,
                  viewUrl,
                });

          return {
            link: buildWhatsAppShareLink(doc.party.phone, message),
            to: doc.party.name,
            message,
          };
        },
      }),
  },


  searchProducts: {
    build: (ctx) =>
      tool({
        description:
          "Full-text search across the catalog by name or SKU. Use when listProducts is too " +
          "coarse and you need a specific item.",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => ({ items: await searchProducts(ctx.tenantId, query) }),
      }),
  },

  findItemByBarcode: {
    build: (ctx) =>
      tool({
        description: "Look up a catalog item by its barcode or SKU, as the till does.",
        inputSchema: z.object({ code: z.string() }),
        execute: async ({ code }) => ({ item: await findItemByBarcode(ctx.tenantId, code) }),
      }),
  },

  fuelAnomalies: {
    build: (ctx) =>
      tool({
        description:
          "Fuel logs that look wrong — consumption out of line with distance, which is how " +
          "fuel-card abuse shows up.",
        inputSchema: z.object({}),
        execute: async () => ({ anomalies: await getFuelAnomalies(ctx.tenantId) }),
      }),
  },

  listConnections: {
    build: (ctx) =>
      tool({
        description:
          "Wholesale trading links with other businesses on the platform — who supplies this " +
          "workspace and who buys from it. Read-only on purpose: inviting a connection creates " +
          "a cross-tenant relationship and a standing pricing agreement, which stays a human " +
          "decision rather than something an agent proposes.",
        inputSchema: z.object({}),
        execute: async () => ({ connections: await listConnectionsForTenant(ctx.tenantId) }),
      }),
  },

  listMessageThreads: {
    build: (ctx) =>
      tool({
        description: "Internal team conversations the signed-in person is part of.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.membershipId) return { threads: [] };
          return { threads: await listThreadsForMember(ctx.tenantId, ctx.membershipId) };
        },
      }),
  },

  readMessageThread: {
    build: (ctx) =>
      tool({
        description: "Messages in one internal thread.",
        inputSchema: z.object({ threadId: z.string() }),
        execute: async ({ threadId }) => ({
          messages: await listMessages(ctx.tenantId, threadId),
        }),
      }),
  },

  listProposalTemplates: {
    build: (ctx) =>
      tool({
        description:
          "Reusable intro and scope-of-work text for proposal quotes. Check here before " +
          "writing scope text from scratch.",
        inputSchema: z.object({}),
        execute: async () => ({ templates: await listProposalTemplates(ctx.tenantId) }),
      }),
  },

  listPdfTemplates: {
    build: (ctx) =>
      tool({
        description: "Document designs available for quotes, invoices and delivery slips.",
        inputSchema: z.object({}),
        execute: async () => ({ templates: await listPdfTemplates(ctx.tenantId) }),
      }),
  },

  listBookingSlots: {
    build: (ctx) =>
      tool({
        description:
          "Appointment slots still free on the public booking page. Use before promising a " +
          "customer a time.",
        inputSchema: z.object({
          daysAhead: z.number().int().positive().optional().default(14),
        }),
        execute: async ({ daysAhead }) => {
          const tenant = await prisma.tenant.findUniqueOrThrow({
            where: { id: ctx.tenantId },
            select: { bookingConfig: true },
          });
          const { getBookingConfig } = await import("@/lib/core/booking");
          const config = getBookingConfig(tenant);
          if (!config.enabled) return { enabled: false, slots: [] };
          return { enabled: true, slots: await listAvailableSlots(ctx.tenantId, config, daysAhead) };
        },
      }),
  },

  listMembers: {
    build: (ctx) =>
      tool({
        description:
          "Nonprofit members and donors: who is currently active, and whose membership is due " +
          "for renewal.",
        inputSchema: z.object({}),
        execute: async () => ({
          active: await listActiveInvolvements(ctx.tenantId),
          dueForRenewal: await checkMembershipRenewals(ctx.tenantId),
        }),
      }),
  },

  listDonations: {
    build: (ctx) =>
      tool({
        description: "Donations received, and totals broken down by designated fund.",
        inputSchema: z.object({}),
        execute: async () => ({
          donations: await listDonations(ctx.tenantId),
          byFund: await totalDonationsByFund(ctx.tenantId),
        }),
      }),
  },

  listMailAccounts: {
    build: (ctx) =>
      tool({
        description: "Mail accounts connected to this workspace.",
        inputSchema: z.object({}),
        execute: async () => ({ accounts: await listEmailAccounts(ctx.tenantId) }),
      }),
  },

  listInboundEmails: {
    build: (ctx) =>
      tool({
        description:
          "Recent mail received into the workspace inbox. Set onlyImportant to see just the " +
          "mail the classifier flagged as needing a person.",
        inputSchema: z.object({ onlyImportant: z.boolean().optional().default(false) }),
        execute: async ({ onlyImportant }) => ({
          emails: await listInboundEmails(ctx.tenantId, onlyImportant),
        }),
      }),
  },

  // ------------------------------------------------------------ the cost spine
  //
  // Everything below reads the machinery that makes "what does this actually
  // cost" answerable: trips, cost per unit of capacity, margin per job and per
  // lane, how much spend is captured at all, and what the officers have found
  // and been worth. The agent gets these as tools so a person can ask in
  // their own words what the pages show.

  tripLog: {
    build: (ctx) =>
      tool({
        description:
          "Recent trips: who drove what where, how far, and what each stopped for. Use for " +
          "'where was the bakkie this week', 'how many runs to Durban', or before costing a job.",
        inputSchema: z.object({
          status: z.enum(["PLANNED", "UNDERWAY", "DONE", "CANCELLED"]).optional(),
          days: z.number().int().min(1).max(365).optional().describe("how far back, default 30"),
        }),
        execute: async ({ status, days }) => {
          const trips = await listTrips(ctx.tenantId, {
            status: status as TripStatus | undefined,
            since: new Date(Date.now() - (days ?? 30) * 86_400_000),
          });
          return trips.map((t) => ({
            id: t.id,
            status: t.status,
            purpose: t.purpose,
            vehicle: t.asset?.name ?? null,
            driver: t.driver?.user.name ?? t.driver?.user.email ?? null,
            from: t.originText,
            to: t.destinationText,
            lane: t.laneKey,
            startedAt: t.startedAt?.toISOString() ?? null,
            endedAt: t.endedAt?.toISOString() ?? null,
            distanceKm: t.distanceKm,
            distanceFrom: t.distanceSource,
            stops: t.stops.map((s) => s.party?.name ?? s.label ?? s.addressText ?? `stop ${s.sequence + 1}`),
            costsRecorded: t._count.expenses,
          }));
        },
      }),
  },

  tripDetail: {
    build: (ctx) =>
      tool({
        description: "One trip in full: stops with arrival and departure times, proof, and the costs tagged to it.",
        inputSchema: z.object({ tripId: z.string() }),
        execute: async ({ tripId }) => {
          const t = await getTrip(ctx.tenantId, tripId);
          if (!t) return { error: "No such trip." };
          return {
            ...t,
            expenses: t.expenses.map((e) => ({ id: e.id, what: e.descriptionText, amountCents: e.amountCents, on: e.spentOn.toISOString().slice(0, 10) })),
          };
        },
      }),
  },

  costPerUnit: {
    build: (ctx) =>
      tool({
        description:
          "What each vehicle or machine costs per kilometre, hour or day, all in — fuel, upkeep, " +
          "insurance and licences, depreciation, the driver's hours — with how sure the figure is. " +
          "Also the fleet as a whole and what share of revenue it is. Use for 'what does the truck " +
          "cost per km', 'is the second van worth it', 'how much do we spend on vehicles'.",
        inputSchema: z.object({
          days: z.number().int().min(7).max(365).optional().describe("period, default 30"),
        }),
        execute: async ({ days }) => {
          const period = lastDays(days ?? 30);
          const [assets, fleet] = await Promise.all([assetCosts(ctx.tenantId, period), fleetCost(ctx.tenantId, period)]);
          return {
            fleet: {
              vehicles: fleet.vehicles,
              totalCents: fleet.totalCents,
              km: fleet.km,
              perKmCents: fleet.perKmCents,
              percentOfRevenue: fleet.percentOfRevenue,
            },
            assets: assets.map((a) => ({
              assetId: a.assetId,
              name: a.name,
              unit: a.capacityUnit,
              totalCents: a.totalCents,
              breakdown: { direct: a.directCents, cover: a.obligationCents, depreciation: a.depreciationCents, labour: a.labourCents },
              units: a.units,
              unitsFrom: a.unitsSource,
              costPerUnitCents: a.costPerUnitCents,
              confidence: a.confidence,
              trips: a.tripCount,
            })),
          };
        },
      }),
  },

  marginReport: {
    build: (ctx) =>
      tool({
        description:
          "What work actually earned after the goods on it, the costs tagged to it and its share of " +
          "the trips that served it — per job, per customer or per lane. Worst first. Use for 'which " +
          "customers lose us money', 'is the Durban run worth it', 'what did that job make'.",
        inputSchema: z.object({
          by: z.enum(["job", "customer", "lane"]),
          days: z.number().int().min(7).max(365).optional().describe("period, default 90"),
        }),
        execute: async ({ by, days }) => {
          const period = lastDays(days ?? 90);
          if (by === "job") return (await jobMargins(ctx.tenantId, period)).slice(0, 40);
          if (by === "customer") return (await customerMargins(ctx.tenantId, period)).slice(0, 40);
          return (await laneMargins(ctx.tenantId, period)).slice(0, 40);
        },
      }),
  },

  captureCoverage: {
    build: (ctx) =>
      tool({
        description:
          "How much of the money that left the bank is actually recorded, and where the gaps are: " +
          "vehicles that moved with no fuel recorded, trips with no distance, spend tagged to nothing. " +
          "Read this before trusting any cost figure. Use for 'are we recording everything', " +
          "'what's missing from the books'.",
        inputSchema: z.object({
          days: z.number().int().min(7).max(365).optional().describe("period, default 30"),
        }),
        execute: async ({ days }) => {
          const to = new Date();
          return captureLedger(ctx.tenantId, { from: new Date(to.getTime() - (days ?? 30) * 86_400_000), to });
        },
      }),
  },

  travelEfficiencyReport: {
    build: (ctx) =>
      tool({
        description:
          "Time between jobs, time on site against time quoted, and days whose stops would have been " +
          "shorter in another order. Use for 'are we wasting time driving', 'which jobs overrun'.",
        inputSchema: z.object({
          days: z.number().int().min(7).max(365).optional().describe("period, default 30"),
        }),
        execute: async ({ days }) => {
          const to = new Date();
          return travelSummary(ctx.tenantId, { from: new Date(to.getTime() - (days ?? 30) * 86_400_000), to });
        },
      }),
  },

  consolidationSavings: {
    build: (ctx) =>
      tool({
        description:
          "What the consolidation engine found: the same goods bought from several suppliers at " +
          "several prices, runs to one area that should have been one, overlapping subscriptions, " +
          "frequent small buys that would be cheaper monthly, scattered insurance. Each with a rand " +
          "figure a year, the effort it would take, and how sure it is. Also every recurring payment " +
          "with its annual cost. Use for 'where can we save', 'what are we paying twice for', " +
          "'list our subscriptions'.",
        inputSchema: z.object({}),
        execute: async () => {
          const r = await consolidationReport(ctx.tenantId);
          return {
            weightedAnnualCents: r.weightedAnnualCents,
            totalAnnualCents: r.totalAnnualCents,
            savings: r.savings.map((s) => ({
              kind: s.kind,
              headline: s.headline,
              detail: s.detail,
              annualCents: s.annualCents,
              effort: EFFORT_LABEL[s.effort],
              confidence: s.confidence,
              evidence: s.evidence,
              proposedAction: s.proposedAction,
            })),
            recurring: r.recurring,
            sourcesThatFailed: r.failed,
          };
        },
      }),
  },

  valueLedgerReport: {
    build: (ctx) =>
      tool({
        description:
          "The value ledger: what the officers found and put in front of the owner, what the owner " +
          "accepted, what has since been verified in the data, and what the platform cost — by month " +
          "and by officer. Use for 'what has this actually saved us', 'is it paying for itself'.",
        inputSchema: z.object({
          months: z.number().int().min(1).max(12).optional().describe("default 3"),
        }),
        execute: async ({ months }) => valueSummary(ctx.tenantId, { months: months ?? 3 }),
      }),
  },

  possibleDuplicateCosts: {
    build: (ctx) =>
      tool({
        description:
          "Costs that look like a second arrival of something already recorded — same supplier, " +
          "amount and day — waiting for someone to confirm or keep both.",
        inputSchema: z.object({}),
        execute: async () => {
          const pairs = await possibleDuplicates(ctx.tenantId);
          return pairs.map((p) => ({
            expenseId: p.expense.id,
            what: p.expense.descriptionText,
            amountCents: p.expense.amountCents,
            on: p.expense.spentOn.toISOString().slice(0, 10),
            status: p.expense.status,
            looksLike: p.lookalike
              ? { expenseId: p.lookalike.id, what: p.lookalike.descriptionText, on: p.lookalike.spentOn.toISOString().slice(0, 10) }
              : null,
          }));
        },
      }),
  },

  // ------------------------------------------------------------ books, completed

  cashFlowStatement: {
    build: (ctx) =>
      tool({
        description: "Where the cash actually went: operating, investing, financing, and how profit turned into cash (or did not). Use for 'why is there no money if we made a profit'.",
        inputSchema: z.object({ from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional() }),
        execute: async ({ from, to }) =>
          cashFlowStatement(ctx.tenantId, { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }),
      }),
  },
  taxPosition: {
    build: (ctx) =>
      tool({
        description: "Tax collected that is not the business's to spend, against the bank; and provisional and payroll tax estimated from posted figures. Use for 'can we afford the VAT', 'how much tax should we be putting aside'.",
        inputSchema: z.object({}),
        execute: async () => ({ vat: await vatSetAside(ctx.tenantId), provisions: await taxProvisions(ctx.tenantId) }),
      }),
  },
  bookValues: {
    build: (ctx) =>
      tool({
        description: "Each asset's cost, what has been depreciated, and its book value, with this month's charge.",
        inputSchema: z.object({}),
        execute: async () => bookValues(ctx.tenantId),
      }),
  },
  listAccruals: {
    build: (ctx) =>
      tool({
        description: "Accruals and deferred income on the books, newest first.",
        inputSchema: z.object({}),
        execute: async () => listAccruals(ctx.tenantId),
      }),
  },
  foreignCurrencyDocuments: {
    build: (ctx) =>
      tool({
        description: "Documents issued in a currency other than the workspace's, with the rate frozen at issue and their worth in the base currency.",
        inputSchema: z.object({}),
        execute: async () => foreignDocuments(ctx.tenantId),
      }),
  },
  monthEndPack: {
    build: (ctx) =>
      tool({
        description: "The bookkeeper's month-end pack: posts what has not reached the books, runs depreciation, proposes bank matches, raises tax provisions, and says what stands between the month and being closed. Defaults to the last month not yet closed.",
        inputSchema: z.object({ year: z.number().int().optional(), month: z.number().int().min(1).max(12).optional() }),
        execute: async ({ year, month }) => {
          const target = year && month ? { year, month } : await nextMonthToClose(ctx.tenantId);
          if (!target) return { note: "Every finished month is already closed." };
          return monthEndPack(ctx.tenantId, target.year, target.month, { post: true });
        },
      }),
  },

  // ------------------------------------------------------------ fleet, sales, legal

  fleetOperations: {
    build: (ctx) =>
      tool({
        description:
          "The fleet in one read: standing time owed at customers' gates, recoverable costs not yet invoiced, " +
          "runs that ended away from base with nothing to bring back, fuel per 100 km by vehicle, services due by " +
          "the odometer, consumables per kilometre, owner-drivers whose cover has lapsed, and routes unusually long " +
          "for their lane. Use for 'how is the fleet', 'what are we losing on the road'.",
        inputSchema: z.object({}),
        execute: async () => {
          const [detention, recoverables, empty, fuel, service, consumables, subcontractors, deviations] = await Promise.all([
            detentionOwed(ctx.tenantId), unbilledRecoverables(ctx.tenantId), emptyRunning(ctx.tenantId), fuelConsumption(ctx.tenantId),
            maintenanceDue(ctx.tenantId), consumablesByAsset(ctx.tenantId), subcontractorsAtRisk(ctx.tenantId), routeDeviations(ctx.tenantId),
          ]);
          return { detention, recoverables, emptyRunning: empty, fuel, serviceDue: service, consumables, subcontractorsAtRisk: subcontractors, routeDeviations: deviations };
        },
      }),
  },
  loadCheck: {
    build: (ctx) =>
      tool({
        description: "Check a planned trip's peak gross weight against what the vehicle may carry, walking the stops in order.",
        inputSchema: z.object({ tripId: z.string() }),
        execute: async ({ tripId }) => (await checkLoad(ctx.tenantId, tripId)) ?? { note: "The vehicle has no tare or permissible weight recorded." },
      }),
  },
  incidents: {
    build: (ctx) =>
      tool({
        description: "Recent incidents on the road, and the insurer's pack for one — with what it still lacks.",
        inputSchema: z.object({ incidentId: z.string().optional() }),
        execute: async ({ incidentId }) => (incidentId ? incidentPack(ctx.tenantId, incidentId) : listIncidents(ctx.tenantId)),
      }),
  },
  salesHealth: {
    build: (ctx) =>
      tool({
        description: "Win rate this quarter against last, quotes being read and not answered, customers whose ordering has gone quiet, and money given away in discounts.",
        inputSchema: z.object({}),
        execute: async () => {
          const now = new Date();
          const q = 90 * 86_400_000;
          return {
            winRateNow: await winRate(ctx.tenantId, new Date(now.getTime() - q), now),
            winRateBefore: await winRate(ctx.tenantId, new Date(now.getTime() - 2 * q), new Date(now.getTime() - q)),
            readingNotAnswering: await readingNotAnswering(ctx.tenantId),
            quietCustomers: await quietCustomers(ctx.tenantId, now),
            discounts: await discountLeak(ctx.tenantId, new Date(now.getTime() - q), now),
          };
        },
      }),
  },
  tenderReadiness: {
    build: (ctx) =>
      tool({
        description: "What a tender desk or main contractor will ask to see — certificates, filings, licences, cover — and which are lapsed, expiring, or have no copy on file.",
        inputSchema: z.object({}),
        execute: async () => tenderReadiness(ctx.tenantId),
      }),
  },
  sharedMemory: {
    build: (ctx) =>
      tool({
        description: "What the business has already decided about the officers' findings — accepted and set aside, with reasons. Read this before suggesting something that may already have been settled.",
        inputSchema: z.object({}),
        execute: async () => sharedMemory(ctx.tenantId),
      }),
  },
  industryPack: {
    build: (ctx) =>
      tool({
        description: "What each officer watches for in this business's trade, and which findings the trade ranks first.",
        inputSchema: z.object({}),
        execute: async () => {
          const { prisma } = await import("@/lib/db");
          const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { niche: true, turnaroundMode: true } });
          return tenant ? { ...packFor(tenant.niche), turnaroundMode: tenant.turnaroundMode } : null;
        },
      }),
  },

  findRecord: {
    build: (ctx) =>
      tool({
        description: "Find the customers, documents, products, assets, trips and pages a name or number refers to. Use when someone names a thing rather than asking about it.",
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => find(ctx.tenantId, query, 12),
      }),
  },
  firstAudit: {
    build: (ctx) =>
      tool({
        description: "The deep read a consultant would charge for: money leaking, work that did not pay, compliance exposure, contracts renewing, money in other people's hands.",
        inputSchema: z.object({}),
        execute: async () => firstAudit(ctx.tenantId),
      }),
  },

  deliveryNotes: {
    build: (ctx) =>
      tool({
        description:
          "Delivery notes — what went out of the door, to whom, and whether it was signed for. " +
          "Use it for 'what did we deliver to X' and 'what is still out'.",
        inputSchema: z.object({
          status: z.enum(["DRAFT", "SENT", "DELIVERED"]).optional(),
          customerId: z.string().optional(),
        }),
        execute: async ({ status, customerId }) => {
          const notes = await listDeliveryNotes(ctx.tenantId, { status, partyId: customerId });
          return notes.map((n) => ({
            id: n.id,
            number: n.number,
            customer: n.party.name,
            status: n.status,
            lines: n.lines.length,
            units: n.lines.reduce((sum, l) => sum + l.quantity, 0),
            written: n.createdAt.toISOString().slice(0, 10),
            delivered: n.deliveredAt?.toISOString().slice(0, 10) ?? null,
          }));
        },
      }),
  },

  setupProgress: {
    build: (ctx) =>
      tool({
        description:
          "What is still missing from this workspace's setup — details, stock, customers, branding — and what has been " +
          "read in from documents so far. Use it when someone asks what else you need from them.",
        inputSchema: z.object({}),
        execute: async () => {
          const [state, documents] = await Promise.all([
            onboardingState(ctx.tenantId),
            listIntakeDocuments(ctx.tenantId, 10),
          ]);
          return {
            finished: state.finished,
            stillToDo: state.remaining.map((r) => r.label),
            products: state.counts.products,
            customers: state.counts.customers,
            read: documents.map((d) => ({ file: d.fileName, kind: d.kind, summary: d.summary })),
          };
        },
      }),
  },
};

// ------------------------------------------------------------------ writing

export const OPS_WRITE_TOOLS: Record<string, OpsToolDef> = {
  // The "just type it" path. Someone pastes a customer and a list of items
  // and says send them a quote; this reads the list, finds or adds the
  // customer, matches the products, and builds the document. It composes
  // only — sending stays a separate, approvable step.
  draftQuoteFromText: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          "Build a DRAFT quote from a plainly written list. Use this when someone gives you " +
          "items and prices in their own words rather than product ids — e.g. '2 x iPhone 16 " +
          "@ R20 000 each, 1 x AirPods Pro 4500'. Pass their text through close to verbatim, " +
          "one item per line, with the customer's name and contact details on the first lines " +
          "(or pass customerId if you already know who it's for). It resolves the customer and " +
          "the products itself, and tells you what it had to create. The quote is a DRAFT — " +
          "say so, and send it only if they ask.",
        inputSchema: z.object({
          text: z
            .string()
            .describe("customer details on the first lines, then one priced item per line"),
          customerId: z
            .string()
            .optional()
            .describe("use this customer instead of whoever the text names"),
          subject: z.string().optional(),
        }),
        execute: async ({ text, customerId, subject }) => {
          const result = await composeQuoteFromText({
            tenantId: ctx.tenantId,
            text,
            customerId,
            subject,
            salesPersonMembershipId: ctx.membershipId ?? undefined,
          });
          return result;
        },
      }),
  },


  createProduct: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Add a product or service to the catalog. Check searchProducts first — a duplicate " +
          "SKU makes every later report wrong.",
        inputSchema: z.object({
          name: z.string(),
          unitPriceCents: z.number().int().min(0),
          sku: z.string().optional(),
          stockQty: z.number().int().min(0).optional(),
          reorderPoint: z.number().int().min(0).optional(),
        }),
        execute: async (input) => {
          const item = await createProduct({ tenantId: ctx.tenantId, ...input });
          return { productId: item.id, name: item.name };
        },
      }),
  },

  updateProduct: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Change a product's details. Only the fields you pass are touched — a price change " +
          "must not silently clear the stock level.",
        inputSchema: z.object({
          productId: z.string(),
          name: z.string().optional(),
          unitPriceCents: z.number().int().min(0).optional(),
          sku: z.string().optional(),
          stockQty: z.number().int().min(0).optional(),
          reorderPoint: z.number().int().min(0).optional(),
        }),
        execute: async ({ productId, ...changes }) => {
          const owned = await prisma.item.findFirst({
            where: { id: productId, tenantId: ctx.tenantId },
            select: { id: true },
          });
          if (!owned) throw new Error("Product not found.");
          await updateProduct(productId, changes);
          return { ok: true, changed: Object.keys(changes) };
        },
      }),
  },

  setProductActive: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Retire a product or bring it back. Deactivating hides it from new quotes without " +
          "touching the history of what was already sold.",
        inputSchema: z.object({ productId: z.string(), isActive: z.boolean() }),
        execute: async ({ productId, isActive }) => {
          const owned = await prisma.item.findFirst({
            where: { id: productId, tenantId: ctx.tenantId },
            select: { id: true },
          });
          if (!owned) throw new Error("Product not found.");
          await setProductActive(productId, isActive);
          return { ok: true };
        },
      }),
  },

  openTill: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Open a till session for the day, with its opening float.",
        inputSchema: z.object({ openingFloatCents: z.number().int().min(0) }),
        execute: async ({ openingFloatCents }) => {
          const session = await openTill({
            tenantId: ctx.tenantId,
            openedById: ctx.membershipId ?? ctx.userId,
            openingFloatCents,
          });
          return { sessionId: session.id };
        },
      }),
  },

  logFuel: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Record a refuelling against a driver, for the fleet cost report.",
        inputSchema: z.object({
          driverId: z.string().describe("membership id from listStaff"),
          litres: z.number().positive(),
          costCents: z.number().int().positive(),
          odometerKm: z.number().int().positive().optional(),
          notes: z.string().optional(),
        }),
        execute: async (input) => {
          const entry = await logFuel({ tenantId: ctx.tenantId, ...input });
          return { fuelLogId: entry.id };
        },
      }),
  },

  sendTeamMessage: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Post into an internal team thread. Colleagues only — this never reaches a customer.",
        inputSchema: z.object({ threadId: z.string(), body: z.string() }),
        execute: async ({ threadId, body }) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          await sendMessage({
            tenantId: ctx.tenantId,
            threadId,
            authorId: ctx.membershipId,
            body,
          });
          return { ok: true };
        },
      }),
  },

  createProposalTemplate: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description: "Save reusable intro/scope text so the next proposal doesn't start blank.",
        inputSchema: z.object({
          name: z.string(),
          introText: z.string().optional(),
          scopeOfWork: z.string().optional(),
        }),
        execute: async (input) => {
          const t = await createProposalTemplate({ tenantId: ctx.tenantId, ...input });
          return { templateId: t.id };
        },
      }),
  },

  setDefaultPdfTemplate: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description: "Choose which document design new quotes and invoices use.",
        inputSchema: z.object({ templateId: z.string() }),
        execute: async ({ templateId }) => {
          await setDefaultPdfTemplate(ctx.tenantId, templateId);
          return { ok: true };
        },
      }),
  },

  recordDonation: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Record a donation against a member or donor.",
        inputSchema: z.object({
          customerId: z.string(),
          amountCents: z.number().int().positive(),
          designatedFund: z.string().optional(),
          receiptNumber: z.string().optional(),
        }),
        execute: async ({ customerId, ...rest }) => {
          const d = await recordDonation({
            tenantId: ctx.tenantId,
            partyId: customerId,
            ...rest,
          });
          return { donationId: d.id };
        },
      }),
  },

  markEmailRead: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Mark an inbound email as read.",
        inputSchema: z.object({ emailId: z.string() }),
        execute: async ({ emailId }) => {
          await markEmailRead(ctx.tenantId, emailId);
          return { ok: true };
        },
      }),
  },
  setUpComplianceCalendar: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Create this business's compliance calendar from the shared library for its " +
          "jurisdiction. If nothing is known about that place yet, it is researched once and the " +
          "result is kept for every later business from the same country. Safe to run more than " +
          "once — anything already on the list is skipped. Show the owner " +
          "proposeComplianceCalendar first and get a yes.",
        inputSchema: z.object({
          countryCode: z.string().describe("ISO 3166-1 alpha-2 country code."),
          regionCode: z.string().optional(),
          isCompany: z.boolean(),
          isVatRegistered: z.boolean(),
          hasEmployees: z.boolean(),
          hasVehicles: z.boolean(),
          registrationMonth: z.number().int().min(1).max(12).optional(),
        }),
        execute: async (profile) => {
          const first = await buildCalendarFromLibrary(ctx.tenantId, profile);
          if (!first.jurisdictionEmpty) return first;

          const research = await researchJurisdiction({
            countryCode: profile.countryCode,
            regionCode: profile.regionCode,
          });
          if (!research.ran) {
            return {
              ...first,
              note:
                "Nothing is known about this jurisdiction yet and it could not be researched " +
                `(${research.skipped}). Ask the owner to upload a licence or certificate — the ` +
                "document names itself, which is more reliable than a guess anyway.",
            };
          }
          const second = await buildCalendarFromLibrary(ctx.tenantId, profile);
          return { ...second, researched: research.added, researchNote: research.note };
        },
      }),
  },

  addObligationFromDocument: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Read a licence, certificate, permit or policy the business has uploaded, and put what " +
          "it represents on the compliance calendar — named the way the document names itself. " +
          "Also teaches the shared library what that document is called in that country, so the " +
          "next business from there is offered it. Use this in preference to guessing what a " +
          "business in an unfamiliar country owes.",
        inputSchema: z.object({
          text: z.string().describe("The document's text content."),
          fileName: z.string().optional(),
        }),
        execute: async ({ text, fileName }) => {
          const outcome = await readObligationFromDocument({ text, fileName });
          if (!outcome.ran || !outcome.reading) {
            return { added: false, reason: outcome.skipped ?? "could not read the document" };
          }
          const r = outcome.reading;
          if (!r.isObligation) {
            return { added: false, reason: "This document has no renewal or expiry deadline." };
          }

          const adopted = await adoptFromDocument({
            tenantId: ctx.tenantId,
            title: r.title,
            kind: r.kind,
            authority: r.authority,
            reference: r.reference,
            expiresOn: r.expiresOn ? new Date(`${r.expiresOn}T12:00:00.000Z`) : null,
            recurrence: r.recurrence,
            severity: r.severity,
            consequence: r.consequence,
            blocksWork: r.blocksWork,
            countryCode: r.countryCode,
            regionCode: r.regionCode,
          });

          return {
            added: true,
            obligationId: adopted.obligationId,
            title: adopted.title,
            dueOn: adopted.dueAt.toISOString().slice(0, 10),
            needsRealDate: adopted.needsRealDate,
            helpedOthers: adopted.contributedToLibrary,
          };
        },
      }),
  },

  addObligation: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Put a dated obligation on the calendar: a filing, licence, certificate, insurance " +
          "renewal, contract notice window, warranty, or a person's or vehicle's document. " +
          "Always write the consequence — what actually happens if it is missed — because that " +
          "is what makes anyone act on it.",
        inputSchema: z.object({
          kind: z.enum([
            "COMPLIANCE_FILING",
            "LICENCE",
            "CERTIFICATE",
            "TAX",
            "INSURANCE",
            "CONTRACT",
            "WARRANTY",
            "DOCUMENT",
          ]),
          title: z.string(),
          dueOn: z.string().describe("Date it falls due, as YYYY-MM-DD."),
          authority: z.string().optional().describe("Who requires it: CIPC, SARS, an insurer, a supplier."),
          reference: z.string().optional(),
          recurrence: z
            .enum(["NONE", "MONTHLY", "BIMONTHLY", "QUARTERLY", "BIANNUAL", "ANNUAL"])
            .optional(),
          severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
          consequence: z.string().optional().describe("Plain sentence: what happens if this is missed."),
          noticeDays: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("For contracts: days before the renewal by which notice must be given."),
          autoRenews: z.boolean().optional(),
          blocksWork: z
            .boolean()
            .optional()
            .describe(
              "True when lapsing should stop work rather than warn — an expired driving permit " +
                "or lapsed liability cover."
            ),
          customerId: z.string().optional(),
          teamMemberId: z.string().optional(),
          itemId: z.string().optional(),
        }),
        execute: async ({ dueOn, customerId, teamMemberId, itemId, ...rest }) => {
          const dueAt = new Date(`${dueOn}T12:00:00.000Z`);
          if (Number.isNaN(dueAt.getTime())) throw new Error("Couldn't read that date.");
          const o = await addObligation({
            ...rest,
            tenantId: ctx.tenantId,
            dueAt,
            partyId: customerId ?? null,
            membershipId: teamMemberId ?? null,
            itemId: itemId ?? null,
          });
          return { obligationId: o.id, dueOn: o.dueAt.toISOString().slice(0, 10) };
        },
      }),
  },

  completeObligation: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Mark an obligation as done. If it repeats, the next one is put on the calendar " +
          "automatically, dated from the original due date rather than from today.",
        inputSchema: z.object({
          obligationId: z.string(),
          notes: z.string().optional(),
        }),
        execute: async ({ obligationId, notes }) => {
          const { completed, next } = await completeObligation({
            tenantId: ctx.tenantId,
            obligationId,
            notes,
          });
          return {
            completedId: completed.id,
            nextDueOn: next ? next.dueAt.toISOString().slice(0, 10) : null,
          };
        },
      }),
  },

  waiveObligation: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Mark an obligation as not applicable to this business, with a reason. It stays on " +
          "record rather than being deleted, so why it is off the list is still answerable later.",
        inputSchema: z.object({ obligationId: z.string(), reason: z.string() }),
        execute: async ({ obligationId, reason }) => {
          await waiveObligation({ tenantId: ctx.tenantId, obligationId, reason });
          return { ok: true };
        },
      }),
  },

  postJournalEntry: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Post a balanced journal entry. Debits must equal credits exactly or it is refused, " +
          "and nothing can be posted into a month that has been closed. Read chartOfAccounts " +
          "first and use real account codes. Prefer describing what happened to the owner over " +
          "posting speculative entries — a wrong entry is corrected by a reversal, never an edit.",
        inputSchema: z.object({
          on: z.string().describe("The date the thing happened, YYYY-MM-DD — not today's date unless it happened today."),
          memo: z.string().describe("What this entry is for, in plain language."),
          lines: z
            .array(
              z.object({
                accountCode: z.string(),
                debit: z.number().nonnegative().optional().describe("Amount in rands, not cents."),
                credit: z.number().nonnegative().optional(),
                memo: z.string().optional(),
              })
            )
            .min(2),
        }),
        execute: async ({ on, memo, lines }) => {
          const entry = await postEntry({
            tenantId: ctx.tenantId,
            entryDate: new Date(`${on}T12:00:00.000Z`),
            memo,
            byAgent: true,
            createdById: ctx.userId,
            lines: lines.map((l) => ({
              accountCode: l.accountCode,
              debitCents: l.debit ? Math.round(l.debit * 100) : 0,
              creditCents: l.credit ? Math.round(l.credit * 100) : 0,
              memo: l.memo,
            })),
          });
          return { entryId: entry.id };
        },
      }),
  },

  reverseJournalEntry: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Undo a posted entry by posting its mirror image. The original stays visible — entries " +
          "are never edited or deleted, so what was believed and when it was corrected both " +
          "survive.",
        inputSchema: z.object({ entryId: z.string(), reason: z.string().optional() }),
        execute: async ({ entryId, reason }) => {
          const entry = await reverseEntry({
            tenantId: ctx.tenantId,
            entryId,
            memo: reason,
            createdById: ctx.userId,
          });
          return { reversalEntryId: entry.id };
        },
      }),
  },

  postHistoryToBooks: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Post the invoices, payments and expenses this business already has into the books, so " +
          "reports are about their real trading rather than an empty ledger. Safe to run more " +
          "than once: anything already posted is skipped, and anything in a closed month is left " +
          "alone.",
        inputSchema: z.object({
          from: z.string().optional().describe("Only post things from this date onward, YYYY-MM-DD."),
        }),
        execute: async ({ from }) => {
          await ensureChartOfAccounts(ctx.tenantId);
          return backfillLedger(ctx.tenantId, {
            from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
          });
        },
      }),
  },

  closeAccountingPeriod: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Close a month so nothing more can be posted into it — by anyone, including you. Do " +
          "this only when the owner has explicitly asked and the month is genuinely finished, " +
          "because reopening it is deliberately not something you can do.",
        inputSchema: z.object({
          year: z.number().int(),
          month: z.number().int().min(1).max(12),
          note: z.string().optional(),
        }),
        execute: async ({ year, month, note }) => {
          await closePeriod({ tenantId: ctx.tenantId, year, month, closedBy: ctx.userId, note });
          return { ok: true, closed: `${year}-${String(month).padStart(2, "0")}` };
        },
      }),
  },

  acceptBankMatch: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Apply a match the owner has approved: post it to the books and mark the statement " +
          "line done. Pass rememberFor with the recurring part of the description — 'SASOL', a " +
          "supplier's name — to make the next one automatic. Only call this after the owner has " +
          "actually said yes to this specific line.",
        inputSchema: z.object({
          bankTransactionId: z.string(),
          kind: z.enum(["invoice", "expense", "account"]),
          targetId: z.string().describe("The invoice, expense or account id from the proposal."),
          rememberFor: z
            .string()
            .optional()
            .describe("Substring of the description worth remembering, for an account match."),
        }),
        execute: async (input) =>
          acceptMatch({ ...input, tenantId: ctx.tenantId, byAgent: true, userId: ctx.userId }),
      }),
  },

  ignoreBankLine: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Set a statement line aside without posting it — an internal transfer between the " +
          "business's own accounts, or something the bank later reversed. Kept rather than " +
          "deleted so it does not come back as new on the next import.",
        inputSchema: z.object({ bankTransactionId: z.string(), note: z.string().optional() }),
        execute: async ({ bankTransactionId, note }) => {
          await ignoreLine({ tenantId: ctx.tenantId, bankTransactionId, note });
          return { ok: true };
        },
      }),
  },

  recordMatchOverruled: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Record that a proposed match was wrong, so the rule that produced it stops being " +
          "trusted. Call this when the owner rejects a suggestion — being overruled once about a " +
          "supplier should mean never being wrong about that supplier again.",
        inputSchema: z.object({ description: z.string() }),
        execute: async ({ description }) => {
          const weakened = await recordOverrule({ tenantId: ctx.tenantId, description });
          return { rulesWeakened: weakened };
        },
      }),
  },

  importBankStatement: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Import a bank statement CSV. Lines already imported are skipped rather than " +
          "duplicated, so an overlapping export is safe. Rows that cannot be read are reported " +
          "rather than dropped.",
        inputSchema: z.object({ bankAccountId: z.string(), csv: z.string() }),
        execute: async ({ bankAccountId, csv }) =>
          importStatement({ tenantId: ctx.tenantId, bankAccountId, csv }),
      }),
  },

  createProgressAgreement: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Set up a job that will be billed in stages — a total value, and the percentage the " +
          "customer holds back from each claim until the defects period ends.",
        inputSchema: z.object({
          customerId: z.string(),
          title: z.string(),
          totalValue: z.number().positive().describe("The whole job, in rands."),
          retentionPercent: z.number().min(0).max(99).optional(),
          retentionDueOn: z
            .string()
            .optional()
            .describe("When the defects period ends, YYYY-MM-DD."),
        }),
        execute: async ({ customerId, totalValue, retentionDueOn, ...rest }) => {
          const a = await createAgreement({
            ...rest,
            tenantId: ctx.tenantId,
            partyId: customerId,
            totalValueCents: Math.round(totalValue * 100),
            retentionDueAt: retentionDueOn ? new Date(`${retentionDueOn}T12:00:00.000Z`) : null,
          });
          return { agreementId: a.id };
        },
      }),
  },

  raiseProgressClaim: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Raise a claim against a progress job. Show the owner previewProgressClaim first — " +
          "this is a figure a quantity surveyor will check, and it should be agreed before it is " +
          "recorded. When a claim takes the job to 100%, the retention becomes a dated obligation " +
          "so it gets chased rather than forgotten.",
        inputSchema: z.object({
          agreementId: z.string(),
          percentComplete: z.number().min(0).max(100),
          invoiceId: z.string().optional(),
        }),
        execute: async (input) => {
          const r = await raiseClaim({ ...input, tenantId: ctx.tenantId });
          return {
            claimId: r.claimId,
            toInvoiceNow: r.breakdown.netCents / 100,
            retentionWithheld: r.breakdown.retentionCents / 100,
            retentionNowTracked: r.retentionObligationId !== null,
          };
        },
      }),
  },

  createBranch: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Add a branch, so profit, people and equipment can be reported per location.",
        inputSchema: z.object({ name: z.string(), code: z.string().optional() }),
        execute: async (input) => {
          const b = await createBranch({ ...input, tenantId: ctx.tenantId });
          return { branchId: b.id };
        },
      }),
  },

  addAsset: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Put a piece of equipment on the asset register.",
        inputSchema: z.object({
          name: z.string(),
          category: z.string().optional().describe("laptop, vehicle, power tool — their words."),
          serial: z.string().optional(),
          purchasePrice: z.number().positive().optional().describe("In rands."),
          usefulLifeMonths: z.number().int().positive().optional(),
        }),
        execute: async ({ purchasePrice, ...rest }) => {
          const asset = await createAsset({
            ...rest,
            tenantId: ctx.tenantId,
            purchaseCents: purchasePrice ? Math.round(purchasePrice * 100) : null,
          });
          return { assetId: asset.id };
        },
      }),
  },

  issueAsset: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Record that a piece of equipment has gone out with somebody. The movement is kept, so " +
          "who had what and when stays answerable later.",
        inputSchema: z.object({
          assetId: z.string(),
          teamMemberId: z.string(),
          note: z.string().optional(),
        }),
        execute: async ({ assetId, teamMemberId, note }) => {
          await issueAsset({
            tenantId: ctx.tenantId,
            assetId,
            toMembershipId: teamMemberId,
            note,
          });
          return { ok: true };
        },
      }),
  },

  returnAsset: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Record equipment coming back, optionally straight into repair.",
        inputSchema: z.object({
          assetId: z.string(),
          toRepair: z.boolean().optional(),
          note: z.string().optional(),
        }),
        execute: async ({ assetId, toRepair, note }) => {
          await returnAsset({ tenantId: ctx.tenantId, assetId, toRepair, note });
          return { ok: true };
        },
      }),
  },

  assetsHeldByPerson: {
    build: (ctx) =>
      tool({
        description: "Everything one person currently has out in their name.",
        inputSchema: z.object({ teamMemberId: z.string() }),
        execute: async ({ teamMemberId }) => {
          const held = await assetsHeldBy(ctx.tenantId, teamMemberId);
          return { count: held.length, assets: held.map((a) => ({ assetId: a.id, name: a.name })) };
        },
      }),
  },

  requestLeave: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Put in a leave request. Working days are worked out from the dates, skipping weekends " +
          "and the workspace's public holidays.",
        inputSchema: z.object({
          teamMemberId: z.string(),
          from: z.string().describe("YYYY-MM-DD"),
          to: z.string().describe("YYYY-MM-DD"),
          kind: z.enum(["ANNUAL", "SICK", "FAMILY", "UNPAID", "PARENTAL", "OTHER"]).optional(),
          reason: z.string().optional(),
        }),
        execute: async ({ teamMemberId, from, to, kind, reason }) => {
          const req = await requestLeave({
            tenantId: ctx.tenantId,
            membershipId: teamMemberId,
            startOn: new Date(`${from}T00:00:00.000Z`),
            endOn: new Date(`${to}T00:00:00.000Z`),
            kind,
            reason,
          });
          return { leaveRequestId: req.id, workingDays: req.days };
        },
      }),
  },

  decideLeave: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Approve or decline a leave request. Check leaveBalances and whoIsAway first — " +
          "approving somebody into a week when everyone else is already off is the mistake this " +
          "is meant to prevent.",
        inputSchema: z.object({ leaveRequestId: z.string(), approve: z.boolean() }),
        execute: async ({ leaveRequestId, approve }) => {
          await decideLeave({
            tenantId: ctx.tenantId,
            leaveRequestId,
            approve,
            decidedById: ctx.membershipId ?? ctx.userId,
          });
          return { ok: true };
        },
      }),
  },

  addEmploymentRecord: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Put a contract, warning, review, qualification or note on somebody's file. These are " +
          "evidence and cannot be edited afterwards, so only record what actually happened and " +
          "what the owner has asked you to record.",
        inputSchema: z.object({
          teamMemberId: z.string(),
          kind: z.enum([
            "CONTRACT",
            "WARNING",
            "REVIEW",
            "QUALIFICATION",
            "ONBOARDING",
            "OFFBOARDING",
            "NOTE",
          ]),
          title: z.string(),
          body: z.string().optional(),
          effectiveOn: z.string().optional().describe("YYYY-MM-DD, defaults to today."),
        }),
        execute: async ({ teamMemberId, effectiveOn, ...rest }) => {
          const record = await addEmploymentRecord({
            ...rest,
            tenantId: ctx.tenantId,
            membershipId: teamMemberId,
            effectiveOn: effectiveOn ? new Date(`${effectiveOn}T12:00:00.000Z`) : undefined,
            recordedById: ctx.userId,
          });
          return { recordId: record.id };
        },
      }),
  },

  classifySpending: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Mark a payment as a business cost or as the owner taking money out for themselves. " +
          "Only classify what you are actually confident about — a wrong split is worse than an " +
          "unanswered one, because it silently distorts what the business appears to cost.",
        inputSchema: z.object({
          expenseId: z.string(),
          isOwnerDrawing: z
            .boolean()
            .describe("True when this was personal spending, false when it was a real business cost."),
        }),
        execute: async ({ expenseId, isOwnerDrawing }) => {
          await classifyExpense({ tenantId: ctx.tenantId, expenseId, isOwnerDrawing });
          return { ok: true };
        },
      }),
  },

  repriceProduct: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Change a product's selling price, optionally bringing its recorded cost up to what is " +
          "actually being paid. Repricing has a customer on the other end of it — propose it and " +
          "get a yes before calling this.",
        inputSchema: z.object({
          itemId: z.string(),
          newPrice: z.number().positive().describe("New selling price in rands, not cents."),
          alsoUpdateCostTo: z
            .number()
            .positive()
            .optional()
            .describe("Correct the catalogue cost at the same time, in rands."),
        }),
        execute: async ({ itemId, newPrice, alsoUpdateCostTo }) => {
          await applySuggestedPrice({
            tenantId: ctx.tenantId,
            itemId,
            unitPriceCents: Math.round(newPrice * 100),
            alsoUpdateCost: alsoUpdateCostTo ? Math.round(alsoUpdateCostTo * 100) : undefined,
          });
          return { ok: true, newPrice };
        },
      }),
  },

  rescheduleObligation: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Correct the date an obligation falls due.",
        inputSchema: z.object({
          obligationId: z.string(),
          dueOn: z.string().describe("New due date, as YYYY-MM-DD."),
        }),
        execute: async ({ obligationId, dueOn }) => {
          const dueAt = new Date(`${dueOn}T12:00:00.000Z`);
          if (Number.isNaN(dueAt.getTime())) throw new Error("Couldn't read that date.");
          await rescheduleObligation({ tenantId: ctx.tenantId, obligationId, dueAt });
          return { ok: true, dueOn };
        },
      }),
  },

  // ------------------------------------------------------------ the cost spine

  startTrip: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description:
          "Start a trip now, or plan one. Names the vehicle, the driver (defaults to whoever is " +
          "asking), where from and to, the odometer at the start, and what it stops for. A stop " +
          "can name a customer, an invoice or a job card — whichever is given, the rest is filled in.",
        inputSchema: z.object({
          assetId: z.string().optional().describe("the vehicle"),
          driverId: z.string().optional().describe("membership id; defaults to the caller"),
          purpose: z.enum(["DELIVERY", "COLLECTION", "SITE_VISIT", "APPOINTMENT", "TRANSFER", "OTHER"]).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          odometerStartKm: z.number().int().optional(),
          planOnly: z.boolean().optional().describe("true to plan it rather than start it now"),
          stops: z
            .array(
              z.object({
                customerId: z.string().optional(),
                transactionId: z.string().optional(),
                jobCardId: z.string().optional(),
                label: z.string().optional(),
                address: z.string().optional(),
              })
            )
            .optional(),
        }),
        execute: async ({ assetId, driverId, purpose, from, to, odometerStartKm, planOnly, stops }) => {
          const trip = await startTrip({
            tenantId: ctx.tenantId,
            assetId: assetId ?? null,
            driverId: driverId ?? ctx.membershipId ?? null,
            purpose: purpose as TripPurpose | undefined,
            originText: from ?? null,
            destinationText: to ?? null,
            odometerStartKm: odometerStartKm ?? null,
            planOnly,
            stops: (stops ?? []).map((s) => ({
              partyId: s.customerId ?? null,
              transactionId: s.transactionId ?? null,
              jobCardId: s.jobCardId ?? null,
              label: s.label ?? null,
              addressText: s.address ?? null,
            })),
          });
          return { tripId: trip.id, status: trip.status, stops: trip.stops.length };
        },
      }),
  },

  addTripStop: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Add a stop to a trip that is planned or underway.",
        inputSchema: z.object({
          tripId: z.string(),
          customerId: z.string().optional(),
          transactionId: z.string().optional(),
          jobCardId: z.string().optional(),
          label: z.string().optional(),
          address: z.string().optional(),
        }),
        execute: async ({ tripId, customerId, transactionId, jobCardId, label, address }) => {
          const stop = await addStop(ctx.tenantId, tripId, {
            partyId: customerId ?? null,
            transactionId: transactionId ?? null,
            jobCardId: jobCardId ?? null,
            label: label ?? null,
            addressText: address ?? null,
          });
          return { stopId: stop.id, sequence: stop.sequence };
        },
      }),
  },

  endTrip: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description:
          "End a trip. Give the odometer at the end if there is one — that beats any other distance. " +
          "A typed distance is used only when there is no odometer and no phone track.",
        inputSchema: z.object({
          tripId: z.string(),
          odometerEndKm: z.number().int().optional(),
          distanceKm: z.number().optional(),
          notes: z.string().optional(),
        }),
        execute: async ({ tripId, odometerEndKm, distanceKm, notes }) => {
          const t = await endTrip(ctx.tenantId, tripId, {
            odometerEndKm: odometerEndKm ?? null,
            distanceKm: distanceKm ?? null,
            notes: notes ?? null,
          });
          return { tripId: t.id, distanceKm: t.distanceKm, distanceFrom: t.distanceSource, endedAt: t.endedAt?.toISOString() };
        },
      }),
  },

  recordCost: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Record a cost with everything known about it: what, how much, when the money left, who " +
          "was paid, the slip number, tax shown, and what it was for — a vehicle, a trip, a job card " +
          "or an invoice. Tags given now are the only tags it will ever have; ask for the vehicle or " +
          "job if it is obviously for one. Says if it looks like a second copy of something recorded.",
        inputSchema: z.object({
          description: z.string(),
          amountRand: z.number().positive(),
          spentOn: z.string().optional().describe("YYYY-MM-DD; default today"),
          supplierName: z.string().optional(),
          reference: z.string().optional().describe("slip or invoice number"),
          taxRand: z.number().optional(),
          accountCode: z.string().optional().describe("chart code, e.g. 5300 for vehicle and fuel"),
          assetId: z.string().optional(),
          tripId: z.string().optional(),
          jobCardId: z.string().optional(),
          transactionId: z.string().optional(),
          quantity: z.number().optional(),
          unit: z.string().optional(),
          odometerKm: z.number().int().optional(),
          isOwnerDrawing: z.boolean().optional().describe("true if this was the owner's own money going out, not a business cost"),
        }),
        execute: async (input) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          const spentOn = input.spentOn ? new Date(`${input.spentOn}T12:00:00.000Z`) : undefined;
          if (spentOn && Number.isNaN(spentOn.getTime())) throw new Error("Couldn't read that date.");
          const e = await submitExpense({
            tenantId: ctx.tenantId,
            submittedById: ctx.membershipId,
            descriptionText: input.description,
            amountCents: Math.round(input.amountRand * 100),
            spentOn,
            source: "AGENT",
            supplierName: input.supplierName ?? null,
            reference: input.reference ?? null,
            taxCents: input.taxRand !== undefined ? Math.round(input.taxRand * 100) : null,
            accountCode: input.accountCode ?? null,
            assetId: input.assetId ?? null,
            tripId: input.tripId ?? null,
            jobCardId: input.jobCardId ?? null,
            transactionId: input.transactionId ?? null,
            quantity: input.quantity ?? null,
            unit: input.unit ?? null,
            odometerKm: input.odometerKm ?? null,
            isOwnerDrawing: input.isOwnerDrawing ?? null,
          });
          return {
            expenseId: e.id,
            status: e.status,
            looksLikeDuplicateOf: e.duplicateOfId,
            note:
              e.status === "DUPLICATE"
                ? "Same slip number and amount as a cost already recorded — kept as a duplicate, not counted."
                : e.duplicateOfId
                  ? "Same supplier, amount and day as a cost already recorded. Ask whether it is the same one."
                  : "Recorded.",
          };
        },
      }),
  },

  markDuplicateCost: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Confirm a cost is a second copy of another. It stays visible, and stops counting.",
        inputSchema: z.object({ expenseId: z.string(), ofExpenseId: z.string() }),
        execute: async ({ expenseId, ofExpenseId }) => {
          await markDuplicate(ctx.tenantId, expenseId, ofExpenseId);
          return { ok: true };
        },
      }),
  },

  keepBothCosts: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Two costs that looked the same are genuinely two. Clears the duplicate flag.",
        inputSchema: z.object({ expenseId: z.string() }),
        execute: async ({ expenseId }) => {
          await keepBoth(ctx.tenantId, expenseId);
          return { ok: true };
        },
      }),
  },

  setStaffCostRate: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Set what an hour of a team member costs the business, including on-costs — what labour " +
          "apportionment multiplies their trip hours by. Not their pay: their cost.",
        inputSchema: z.object({
          membershipId: z.string(),
          ratePerHourRand: z.number().min(0).nullable().describe("null to clear"),
        }),
        execute: async ({ membershipId, ratePerHourRand }) => {
          await setCostRate(ctx.tenantId, membershipId, ratePerHourRand === null ? null : Math.round(ratePerHourRand * 100));
          return { ok: true };
        },
      }),
  },

  setAssetCapacity: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Say what one unit of an asset's capacity is — KM for a vehicle, HOUR for a machine, DAY " +
          "for a crew — and its registration or plate. Without a unit no cost-per figure is produced for it.",
        inputSchema: z.object({
          assetId: z.string(),
          capacityUnit: z.enum(["KM", "HOUR", "DAY"]).nullable(),
          registration: z.string().optional(),
        }),
        execute: async ({ assetId, capacityUnit, registration }) => {
          await setAssetCapacity(ctx.tenantId, assetId, { capacityUnit, registration });
          return { ok: true };
        },
      }),
  },

  accrueExpense: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Book a cost into this month that has not been billed yet, with its reversal on the first of next month.",
        inputSchema: z.object({ on: z.string().describe("YYYY-MM-DD"), amountRand: z.number().positive(), accountCode: z.string(), memo: z.string() }),
        execute: async ({ on, amountRand, accountCode, memo }) => {
          const r = await accrueExpense({ tenantId: ctx.tenantId, on: new Date(`${on}T12:00:00Z`), amountCents: Math.round(amountRand * 100), expenseAccountCode: accountCode, memo });
          return { entryId: r.entry.id, reversalId: r.reversal.id };
        },
      }),
  },
  deferRevenue: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Move money received in advance out of this month's sales and into the month the work is done.",
        inputSchema: z.object({ on: z.string(), earnedOn: z.string(), amountRand: z.number().positive(), memo: z.string() }),
        execute: async ({ on, earnedOn, amountRand, memo }) => {
          const r = await deferRevenue({ tenantId: ctx.tenantId, on: new Date(`${on}T12:00:00Z`), earnedOn: new Date(`${earnedOn}T12:00:00Z`), amountCents: Math.round(amountRand * 100), memo });
          return { entryId: r.entry.id, releaseId: r.release.id };
        },
      }),
  },
  runDepreciation: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Post the month's depreciation for every asset with a cost and a life. Safe to repeat — a month already charged posts nothing.",
        inputSchema: z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }),
        execute: async ({ year, month }) => runMonthlyDepreciation(ctx.tenantId, year, month),
      }),
  },
  setDocumentCurrency: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Issue a document in another currency at a rate frozen now. Cannot change once anything is paid against it.",
        inputSchema: z.object({ transactionId: z.string(), currency: z.string().length(3), rateToBase: z.number().positive().describe("one unit of the document currency in the workspace currency") }),
        execute: async ({ transactionId, currency, rateToBase }) => {
          await setDocumentCurrency({ tenantId: ctx.tenantId, transactionId, currency, rateToBase });
          return { ok: true };
        },
      }),
  },

  billDetention: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Put a stop's billable standing time onto a DRAFT invoice for that customer, with the arrival and departure times on it.",
        inputSchema: z.object({ stopId: z.string() }),
        execute: async ({ stopId }) => {
          const inv = await billDetention(ctx.tenantId, stopId);
          return { invoiceId: inv.id, amountCents: inv.amountCents, status: inv.status };
        },
      }),
  },
  billRecoverables: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Put a customer's recoverable costs (tolls, permits, materials for their job) onto one DRAFT invoice.",
        inputSchema: z.object({ customerId: z.string() }),
        execute: async ({ customerId }) => {
          const r = await billRecoverables(ctx.tenantId, customerId);
          return { invoiceId: r.invoice.id, lines: r.lines, totalCents: r.totalCents };
        },
      }),
  },
  markRecoverable: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Mark a recorded cost as one the customer should pay back, or not.",
        inputSchema: z.object({ expenseId: z.string(), recoverable: z.boolean() }),
        execute: async ({ expenseId, recoverable }) => {
          await setRecoverable(ctx.tenantId, expenseId, recoverable);
          return { ok: true };
        },
      }),
  },
  recordVehicleService: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description: "Record that a vehicle was serviced at an odometer reading, so the next service is due from there.",
        inputSchema: z.object({ assetId: z.string(), odometerKm: z.number().int() }),
        execute: async ({ assetId, odometerKm }) => {
          await recordService(ctx.tenantId, assetId, odometerKm);
          return { ok: true };
        },
      }),
  },
  setVehicleSpec: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description: "Set a vehicle's service interval in km, last service reading, empty weight and permissible gross weight.",
        inputSchema: z.object({
          assetId: z.string(),
          serviceIntervalKm: z.number().int().nullable(),
          lastServiceKm: z.number().int().nullable().optional(),
          tareKg: z.number().int().nullable().optional(),
          maxGrossKg: z.number().int().nullable().optional(),
        }),
        execute: async ({ assetId, ...rest }) => {
          await setServicePlan(ctx.tenantId, assetId, rest);
          return { ok: true };
        },
      }),
  },
  setStopLoad: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Set the weight loaded (positive) or dropped (negative) at a trip stop, in kg.",
        inputSchema: z.object({ stopId: z.string(), loadKg: z.number().int().nullable() }),
        execute: async ({ stopId, loadKg }) => {
          await setStopLoad(ctx.tenantId, stopId, loadKg);
          return { ok: true };
        },
      }),
  },
  reportIncident: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Start an incident report at the scene: what happened, the other party, where. Says what the insurer will still need.",
        inputSchema: z.object({
          description: z.string(),
          tripId: z.string().optional(),
          assetId: z.string().optional(),
          otherParty: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        }),
        execute: async (input) => {
          const inc = await reportIncident({ tenantId: ctx.tenantId, driverId: ctx.membershipId ?? null, ...input });
          return { incidentId: inc.id, stillNeeded: inc.missing };
        },
      }),
  },
  addToIncident: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Add the other party's details or a fuller description to an incident.",
        inputSchema: z.object({ incidentId: z.string(), otherParty: z.string().optional(), description: z.string().optional() }),
        execute: async ({ incidentId, ...rest }) => {
          const inc = await addToIncident(ctx.tenantId, incidentId, rest);
          return { stillNeeded: inc.missing };
        },
      }),
  },
  setTurnaroundMode: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Switch turnaround mode on or off. On, every officer's findings are reordered around cash and survival; optimisation waits.",
        inputSchema: z.object({ on: z.boolean() }),
        execute: async ({ on }) => {
          await setTurnaroundMode(ctx.tenantId, on);
          return { turnaroundMode: on };
        },
      }),
  },

  // Setting up, from a conversation rather than the screens. Somebody pastes
  // a price list into the box and says "add these" — this is what makes that
  // work, on the same terms as the review screen: nothing is duplicated.
  addProducts: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Add products to the catalogue, or update the ones already there. Matches by code where there is one and by " +
          "name where there is not, so the same list added twice does not double the catalogue. Money in cents.",
        inputSchema: z.object({
          products: z
            .array(
              z.object({
                name: z.string(),
                sku: z.string().nullable().optional(),
                unit: z.string().nullable().optional(),
                unitPriceCents: z.number().int().nullable().optional(),
                costCents: z.number().int().nullable().optional(),
                quantityOnHand: z.number().int().nullable().optional(),
                taxRatePercent: z.number().int().nullable().optional(),
                category: z.string().nullable().optional(),
              })
            )
            .max(200),
        }),
        execute: async ({ products }) => {
          const rows = products.map((p, i) => ({
            key: `said:${i}`,
            name: p.name,
            sku: p.sku ?? null,
            unit: p.unit ?? null,
            unitPriceCents: p.unitPriceCents ?? null,
            costCents: p.costCents ?? null,
            quantityOnHand: p.quantityOnHand ?? null,
            taxRatePercent: p.taxRatePercent ?? null,
            category: p.category ?? null,
            source: "what you told me",
          }));
          return upsertProducts(ctx.tenantId, rows);
        },
      }),
  },

  addContacts: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          "Add customers or suppliers in bulk, or fill in details for ones already on file. Matches by email where there " +
          "is one and by name where there is not.",
        inputSchema: z.object({
          role: z.enum(["CUSTOMER", "SUPPLIER"]),
          contacts: z
            .array(
              z.object({
                name: z.string(),
                companyName: z.string().nullable().optional(),
                email: z.string().nullable().optional(),
                phone: z.string().nullable().optional(),
                vatNumber: z.string().nullable().optional(),
                address: z.string().nullable().optional(),
              })
            )
            .max(200),
        }),
        execute: async ({ role, contacts }) => {
          const rows = contacts.map((c, i) => ({
            key: `said:${i}`,
            name: c.name,
            companyName: c.companyName ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            vatNumber: c.vatNumber ?? null,
            address: c.address ?? null,
            source: "what you told me",
          }));
          return upsertParties(ctx.tenantId, rows, role as PartyRole);
        },
      }),
  },

  setBusinessDetails: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Set the business's own details — registered name, registration and VAT numbers, address, contact details, and " +
          "the bank account invoices are paid into. Only pass what you were actually told; anything left out stays as it is.",
        inputSchema: z.object({
          name: z.string().optional(),
          registrationNumber: z.string().optional(),
          entityType: z.string().optional(),
          vatNumber: z.string().optional(),
          businessAddress: z.string().optional(),
          businessEmail: z.string().optional(),
          businessPhone: z.string().optional(),
          countryCode: z.string().optional(),
          bankName: z.string().optional(),
          bankAccountHolder: z.string().optional(),
          bankAccountNumber: z.string().optional(),
          bankBranchCode: z.string().optional(),
          buildComplianceCalendar: z
            .boolean()
            .optional()
            .describe("Also put what a business like this owes on the compliance calendar."),
        }),
        execute: async ({ buildComplianceCalendar, ...fields }) => {
          const business = Object.fromEntries(
            Object.entries(fields).filter(([k]) => !k.startsWith("bank"))
          ) as Record<string, string>;
          const banking = Object.fromEntries(
            Object.entries(fields).filter(([k]) => k.startsWith("bank"))
          ) as Record<string, string>;
          const result = await applyProposal(ctx.tenantId, {
            business,
            banking,
            obligations: [],
            customers: [],
            suppliers: [],
            products: [],
            buildCalendar: buildComplianceCalendar ?? false,
          });
          return {
            saved: result.businessFields + result.bankingFields,
            calendarAdded: result.calendarAdded,
            problems: result.problems,
          };
        },
      }),
  },

  // The packing slip, written against what is still outstanding on a
  // document — so a part delivery leaves the rest owed rather than closing
  // the order.
  writeDeliveryNote: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description:
          "Write a delivery note. Give it an invoice or quote id and it starts with everything on that document that has " +
          "not gone out yet; otherwise give a customer and the lines. It carries no prices — a packing slip that shows " +
          "what things cost is how a customer learns your margin.",
        inputSchema: z.object({
          documentId: z.string().optional().describe("The invoice or quote being delivered against."),
          customerId: z.string().optional(),
          lines: z
            .array(z.object({ description: z.string(), quantity: z.number().int().positive(), unit: z.string().optional() }))
            .optional(),
          deliveryAddress: z.string().optional(),
          reference: z.string().optional().describe("Their order number, when they gave one."),
          notes: z.string().optional().describe("Gate code, delivery window, who to ask for."),
        }),
        execute: async (input) => {
          const note = await createDeliveryNote({
            tenantId: ctx.tenantId,
            transactionId: input.documentId ?? null,
            partyId: input.customerId ?? null,
            lines: input.lines?.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit ?? null })),
            deliveryAddress: input.deliveryAddress ?? null,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            createdById: ctx.membershipId ?? null,
          });
          return {
            id: note.id,
            number: note.number,
            customer: note.party.name,
            lines: note.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit })),
          };
        },
      }),
  },

  markDelivered: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Record that a delivery note arrived, and who signed for it.",
        inputSchema: z.object({ deliveryNoteId: z.string(), signedBy: z.string().optional() }),
        execute: async ({ deliveryNoteId, signedBy }) => {
          const note = await markDelivered(ctx.tenantId, deliveryNoteId, { signedBy: signedBy ?? null });
          return { number: note.number, status: note.status, deliveredAt: note.deliveredAt?.toISOString() ?? null };
        },
      }),
  },
};
