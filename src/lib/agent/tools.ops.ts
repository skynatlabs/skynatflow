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
import { exportTenant } from "@/lib/core/portability";
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

  exportEverything: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Produce a complete export of this workspace's data — every table, with a manifest. " +
          "Integration credentials are deliberately left out. Returns a summary rather than the " +
          "whole file, which would be far too large for a conversation; point the owner at " +
          "Settings for the download.",
        inputSchema: z.object({}),
        execute: async () => {
          const { manifest } = await exportTenant(ctx.tenantId);
          return {
            businessName: manifest.businessName,
            totalRows: manifest.totalRows,
            tables: manifest.tables
              .filter((t) => t.rows > 0)
              .map((t) => ({ table: t.label, rows: t.rows })),
            notes: manifest.notes,
          };
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
};
