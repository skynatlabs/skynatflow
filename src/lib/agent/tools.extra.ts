// The rest of the Business Graph, as tools.
//
// tools.ts covers the money/customer core. This file covers everything else
// the app can do — stock, work, property, people, reporting — so "the AI has
// access to every feature" is literally true rather than aspirational.
//
// Same two invariants as tools.ts, and they are what make this safe to grow:
//   1. No tool schema contains a tenantId; the runtime closes over it.
//   2. Every tool calls the same src/lib/core/* function the dashboard calls,
//      so tenant scoping and capability checks apply identically.
//
// Kept in a separate file purely so neither grows past the point of being
// readable; buildAgentTools merges the two registries.

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Capability } from "@/lib/core/access";
import type { AgentContext } from "@/lib/agent/tools";
import { rememberFact, forgetFact, loadFacts } from "@/lib/agent/memory";
import { buildCashForecast } from "@/lib/core/cashForecast";
import { getReadiness } from "@/lib/core/readiness";

import { getDemandHeatmap, getReorderSuggestions, getExpiryRisk } from "@/lib/core/inventory";
import { listExpenses, submitExpense, approveExpense, rejectExpense } from "@/lib/core/expenses";
import { listJobCards, createJobCard, setJobCardStatus, completeJobCard } from "@/lib/core/jobCards";
import { getTeamPerformance, suggestSalesPersonForNewLead } from "@/lib/core/salesReporting";
import { listGoals, createGoal, updateGoalProgress } from "@/lib/core/goals";
import { getOrgChart } from "@/lib/core/org";
import { getTeamAttendance, getTimesheet } from "@/lib/core/attendance";
import { listPurchaseOrders, markPurchaseOrderReceived } from "@/lib/core/purchaseOrders";
import { getShrinkageReport, recordStocktake } from "@/lib/core/stocktake";
import { getActiveRentals, getOverdueRentals, returnRental } from "@/lib/core/rentals";
import { listProperties, getExpiringLeases, listAvailableProperties } from "@/lib/core/property";
import { getAgingDenials, listClaims } from "@/lib/core/claims";
import { getOverdueInvoices, applyLateFee } from "@/lib/core/collections";
import { getTodayPlan } from "@/lib/core/dayPlan";
import {
  listThisWeekFollowUps,
  setManualReminder,
  clearManualReminder,
} from "@/lib/core/followUpReminders";
import { listRecurringInvoices, setRecurringInvoiceActive } from "@/lib/core/recurring";
import { getTaxSummary } from "@/lib/core/tax";
import { addNote, listNotes, listTeamNotes } from "@/lib/core/notes";
import { addComment, listComments } from "@/lib/core/comments";
import { logDelivery } from "@/lib/core/movement";
import { getQuoteSlaBreaches } from "@/lib/core/sla";
import { listNotifications } from "@/lib/core/notifications2";
import { acceptDetails, listSubmissions, markSubmissionHandled } from "@/lib/core/portal";
import {
  AGREEMENT_TEMPLATES,
  agreementPipeline,
  createAgreement,
  getAgreement,
  listAgreements,
  sendAgreement,
  signatureStillMatches,
} from "@/lib/core/agreements";
import { draftAgreement, kindFromDraft, withDisclaimer } from "@/lib/ai/agreement";
import { SYSTEM_BY_KEY, addSystem, listSystems, switchover } from "@/lib/core/systems";
import { kpiBoard } from "@/lib/core/kpis";
import { cancelPaymentPlan, createPaymentPlan, evenInstalments, paymentPlanFor } from "@/lib/core/paymentPlans";
import { currencyForCustomer, fxPosition, rateOn, setCustomerCurrency, setRate } from "@/lib/core/fx";
import { approveBill, buildPaymentRun, listBills, payablesSummary, payBill, recordBill } from "@/lib/core/supplierBills";
import { computeVatReturn, driftSinceFiling, listVatReturns, saveDraftReturn, vatPeriodFor } from "@/lib/core/vatReturn";
import { chaseHistory, chaseList, draftChase, ladderEffect, recordChase } from "@/lib/core/collectionsLadder";
import { applyCoding, forgetCodingRule, listCodingRules, rememberCorrection } from "@/lib/core/expenseCoding";
import { workKindMargins } from "@/lib/core/workKinds";
import { feedStatus, syncFeed } from "@/lib/core/bankFeeds";
import { lastDays } from "@/lib/core/costing";
import { customerTimeline } from "@/lib/core/timeline";
import { CHANNELS, consentFor, consentSummary, mayContact, setConsent, type Channel } from "@/lib/core/consent";
import {
  addConversationNote,
  assign,
  closeConversation,
  conversationNotes,
  listConversations,
  responseHealth,
  snooze,
} from "@/lib/core/conversations";
import { callHealth, handleMissedCall, listCalls, logCall, markCallResponded, unansweredMissedCalls } from "@/lib/core/calls";
import { createLeadForm, leadResponseHealth, listLeadForms, listSubmissions as listLeads, markLeadHandled } from "@/lib/core/leadForms";
import { draftBroadcast, listBroadcasts, previewAudience } from "@/lib/core/broadcast";
import { disputeHealth, listDisputes, resolveDispute } from "@/lib/core/disputes";
import { inviteStaff } from "@/lib/core/staff";
import { recordCashSale } from "@/lib/core/money";
import { formatMoney } from "@/lib/format/money";
import type { AgreementState, BillStatus, DisputeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface ExtraToolDef {
  capability?: Capability;
  build: (ctx: AgentContext) => ToolSet[string];
}

// ------------------------------------------------------------------ reading

export const EXTRA_READ_TOOLS: Record<string, ExtraToolDef> = {
  setupReadiness: {
    build: (ctx) =>
      tool({
        description:
          "How far this workspace is from actually running the business on flow, and what " +
          "the single most useful next step is. Use it when someone asks what to do next, " +
          "when something they want isn't working because a prerequisite is missing, or " +
          "when you are looking for something genuinely worth raising with a new workspace.",
        inputSchema: z.object({}),
        execute: async () => {
          const readiness = await getReadiness(ctx.tenantId);
          return {
            percent: readiness.percent,
            operational: readiness.operational,
            nextStep: readiness.nextStep
              ? { label: readiness.nextStep.label, why: readiness.nextStep.why }
              : null,
            outstanding: readiness.steps
              .filter((s) => !s.done)
              .map((s) => ({ step: s.label, why: s.why, importance: s.weight })),
          };
        },
      }),
  },

  cashForecast: {
    build: (ctx) =>
      tool({
        description:
          "Thirteen weeks of projected cash, built from invoices owed, recurring work and " +
          "typical running costs. Use this for any question about affording something, " +
          "whether money will be tight, or when it will be — it is the only tool that looks " +
          "forward rather than at what has already happened. Every line carries the reason " +
          "it is there; repeat those reasons rather than presenting the total as fact.",
        inputSchema: z.object({
          openingBalanceCents: z
            .number()
            .int()
            .optional()
            .describe("cash on hand now, if the user told you; otherwise leave it out"),
        }),
        execute: async ({ openingBalanceCents }) => {
          const forecast = await buildCashForecast({
            tenantId: ctx.tenantId,
            openingCents: openingBalanceCents ?? 0,
          });
          return {
            openingCents: forecast.openingCents,
            totalInflowCents: forecast.totalInflowCents,
            totalOutflowCents: forecast.totalOutflowCents,
            lowestCents: forecast.lowestCents,
            lowestWeek: forecast.lowestWeek + 1,
            shortfallWeek: forecast.shortfallWeek === null ? null : forecast.shortfallWeek + 1,
            caveats: forecast.caveats,
            weeks: forecast.weeks.map((w) => ({
              week: w.index + 1,
              starting: w.weekStart,
              inCents: w.inflowCents,
              outCents: w.outflowCents,
              closingCents: w.closingCents,
              inflows: w.inflows.map((l) => `${l.label}: ${l.amountCents} (${l.basis})`),
            })),
          };
        },
      }),
  },

  recallFacts: {
    build: (ctx) =>
      tool({
        description:
          "Everything you have been told or worked out about this business and written down. " +
          "The most recent are already in your instructions; read this when you need the " +
          "full list, or to check whether you already know something before asking.",
        inputSchema: z.object({}),
        execute: async () => ({ facts: await loadFacts(ctx.tenantId) }),
      }),
  },


  todayPlan: {
    build: (ctx) =>
      tool({
        description:
          "What actually needs doing today: follow-ups due, appointments, overdue money. " +
          "Use this for 'what should I do today' rather than assembling it yourself.",
        inputSchema: z.object({}),
        execute: async () => getTodayPlan(ctx.tenantId),
      }),
  },

  thisWeekFollowUps: {
    build: (ctx) =>
      tool({
        description: "Follow-ups scheduled for this week, with who and when.",
        inputSchema: z.object({}),
        execute: async () => ({ followUps: await listThisWeekFollowUps(ctx.tenantId) }),
      }),
  },

  overdueInvoices: {
    build: (ctx) =>
      tool({
        description:
          "Every invoice past its due date, with how late and how much. The starting point " +
          "for any collections question.",
        inputSchema: z.object({}),
        execute: async () => ({ invoices: await getOverdueInvoices(ctx.tenantId) }),
      }),
  },

  quoteSlaBreaches: {
    build: (ctx) =>
      tool({
        description: "Quotes that have sat unanswered past the workspace's response target.",
        inputSchema: z.object({}),
        execute: async () => ({ breaches: await getQuoteSlaBreaches(ctx.tenantId) }),
      }),
  },

  reorderSuggestions: {
    build: (ctx) =>
      tool({
        description:
          "Products at or below their reorder point, with a suggested quantity. Use before " +
          "answering anything about restocking.",
        inputSchema: z.object({}),
        execute: async () => ({ suggestions: await getReorderSuggestions(ctx.tenantId) }),
      }),
  },

  demandHeatmap: {
    build: (ctx) =>
      tool({
        description: "Which products are actually selling, and how fast.",
        inputSchema: z.object({}),
        execute: async () => ({ demand: await getDemandHeatmap(ctx.tenantId) }),
      }),
  },

  expiryRisk: {
    build: (ctx) =>
      tool({
        description: "Batch-tracked stock approaching its expiry date.",
        inputSchema: z.object({
          withinDays: z.number().int().positive().optional().default(14),
        }),
        execute: async ({ withinDays }) => ({
          atRisk: await getExpiryRisk(ctx.tenantId, withinDays),
        }),
      }),
  },

  shrinkageReport: {
    build: (ctx) =>
      tool({
        description: "Stock counted versus stock expected — where inventory is going missing.",
        inputSchema: z.object({}),
        execute: async () => ({ shrinkage: await getShrinkageReport(ctx.tenantId) }),
      }),
  },

  listPurchaseOrders: {
    build: (ctx) =>
      tool({
        description: "Purchase orders raised with suppliers, and their status.",
        inputSchema: z.object({ page: z.number().int().positive().optional().default(1) }),
        execute: async ({ page }) => listPurchaseOrders(ctx.tenantId, page),
      }),
  },

  listJobCards: {
    build: (ctx) =>
      tool({
        description: "Work orders — the physical jobs behind sales, and where each one is.",
        inputSchema: z.object({}),
        execute: async () => ({ jobCards: await listJobCards(ctx.tenantId) }),
      }),
  },

  listExpenses: {
    build: (ctx) =>
      tool({
        description: "Staff expense claims, optionally filtered by status.",
        inputSchema: z.object({
          status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
          page: z.number().int().positive().optional().default(1),
        }),
        execute: async ({ status, page }) => listExpenses(ctx.tenantId, status, page),
      }),
  },

  teamPerformance: {
    build: (ctx) =>
      tool({
        description: "How each salesperson is doing — quotes sent, won, revenue.",
        inputSchema: z.object({
          sinceIso: z.string().optional().describe("ISO 8601 date to measure from"),
        }),
        execute: async ({ sinceIso }) =>
          getTeamPerformance(ctx.tenantId, sinceIso ? new Date(sinceIso) : undefined),
      }),
  },

  suggestSalesperson: {
    build: (ctx) =>
      tool({
        description: "Who has the lightest current load and should take a new lead.",
        inputSchema: z.object({}),
        execute: async () => suggestSalesPersonForNewLead(ctx.tenantId),
      }),
  },

  orgChart: {
    build: (ctx) =>
      tool({
        description: "Who reports to whom in this workspace.",
        inputSchema: z.object({}),
        execute: async () => ({ chart: await getOrgChart(ctx.tenantId) }),
      }),
  },

  teamAttendance: {
    build: (ctx) =>
      tool({
        description: "Who is clocked in right now.",
        inputSchema: z.object({}),
        execute: async () => ({ attendance: await getTeamAttendance(ctx.tenantId) }),
      }),
  },

  timesheet: {
    build: (ctx) =>
      tool({
        description: "Hours worked by one staff member over a period.",
        inputSchema: z.object({
          membershipId: z.string(),
          fromIso: z.string().optional().describe("ISO 8601; defaults to the start of this month"),
          toIso: z.string().optional().describe("ISO 8601; defaults to now"),
        }),
        execute: async ({ membershipId, fromIso, toIso }) => {
          const to = toIso ? new Date(toIso) : new Date();
          const from = fromIso
            ? new Date(fromIso)
            : new Date(to.getFullYear(), to.getMonth(), 1);
          return getTimesheet(ctx.tenantId, membershipId, from, to);
        },
      }),
  },

  listGoals: {
    build: (ctx) =>
      tool({
        description: "Targets this workspace has set, and progress against them.",
        inputSchema: z.object({}),
        execute: async () => ({ goals: await listGoals(ctx.tenantId) }),
      }),
  },

  activeRentals: {
    build: (ctx) =>
      tool({
        description: "Items currently out on rental, and which are overdue back.",
        inputSchema: z.object({}),
        execute: async () => ({
          active: await getActiveRentals(ctx.tenantId),
          overdue: await getOverdueRentals(ctx.tenantId),
        }),
      }),
  },

  listProperties: {
    build: (ctx) =>
      tool({
        description: "Properties managed, their status, and leases expiring soon.",
        inputSchema: z.object({ page: z.number().int().positive().optional().default(1) }),
        execute: async ({ page }) => ({
          properties: await listProperties(ctx.tenantId, page),
          available: await listAvailableProperties(ctx.tenantId),
          expiringLeases: await getExpiringLeases(ctx.tenantId),
        }),
      }),
  },

  listClaims: {
    build: (ctx) =>
      tool({
        description:
          "Insurance claims and, importantly, denied claims that are aging without being " +
          "reworked — money quietly being written off.",
        inputSchema: z.object({ page: z.number().int().positive().optional().default(1) }),
        execute: async ({ page }) => ({
          claims: await listClaims(ctx.tenantId, page),
          agingDenials: await getAgingDenials(ctx.tenantId),
        }),
      }),
  },

  listRecurringInvoices: {
    build: (ctx) =>
      tool({
        description: "Subscription and repeat-billing templates, and when each next runs.",
        inputSchema: z.object({}),
        execute: async () => ({ templates: await listRecurringInvoices(ctx.tenantId) }),
      }),
  },

  taxSummary: {
    build: (ctx) =>
      tool({
        description: "VAT/tax collected and paid over a period, for a return or a check.",
        inputSchema: z.object({
          fromIso: z.string().optional().describe("ISO 8601 start date"),
          toIso: z.string().optional().describe("ISO 8601 end date"),
          grouping: z
            .enum(["monthly", "sars-bimonthly"])
            .optional()
            .describe("sars-bimonthly matches the SA VAT return period"),
        }),
        execute: async ({ fromIso, toIso, grouping }) =>
          getTaxSummary(ctx.tenantId, {
            from: fromIso ? new Date(fromIso) : undefined,
            to: toIso ? new Date(toIso) : undefined,
            grouping,
          }),
      }),
  },

  teamNotes: {
    build: (ctx) =>
      tool({
        description:
          "What the team has left each other on the workspace's notes board, newest first, pinned ones on top. " +
          "Use it when somebody asks what was said about a job, a customer or a site.",
        inputSchema: z.object({}),
        execute: async () => {
          const notes = await listTeamNotes(ctx.tenantId, ctx.membershipId ?? null, 40);
          return notes.map((n) => ({
            title: n.title,
            body: n.body,
            by: n.authorName,
            when: n.createdAt.toISOString().slice(0, 10),
            pinned: n.pinned,
            told: n.mentionNames,
          }));
        },
      }),
  },

  listNotes: {
    build: (ctx) =>
      tool({
        description: "Notes recorded against a customer, quote, invoice or job.",
        inputSchema: z.object({
          entityType: z.string().describe("e.g. Party, Transaction, JobCard"),
          entityId: z.string().optional(),
        }),
        execute: async ({ entityType, entityId }) => ({
          notes: await listNotes(ctx.tenantId, entityType, entityId),
        }),
      }),
  },

  listComments: {
    build: (ctx) =>
      tool({
        description:
          "Team discussion recorded against a record — distinct from notes, which are the " +
          "record's own history rather than a conversation about it.",
        inputSchema: z.object({
          entityType: z.string().describe("e.g. Party, Transaction, JobCard"),
          entityId: z.string(),
        }),
        execute: async ({ entityType, entityId }) => ({
          comments: await listComments(ctx.tenantId, entityType, entityId),
        }),
      }),
  },

  listNotifications: {
    build: (ctx) =>
      tool({
        description: "Recent alerts raised to this workspace.",
        inputSchema: z.object({}),
        execute: async () => ({
          notifications: await listNotifications(ctx.tenantId, ctx.membershipId ?? undefined),
        }),
      }),
  },

  listStaff: {
    build: (ctx) =>
      tool({
        description:
          "Everyone with an account on this workspace, with their role and membership id. " +
          "Use to resolve a name before assigning work to them.",
        inputSchema: z.object({}),
        execute: async () => {
          const members = await prisma.membership.findMany({
            where: { tenantId: ctx.tenantId },
            include: { user: { select: { name: true, email: true } } },
          });
          return {
            staff: members.map((m) => ({
              membershipId: m.id,
              name: m.user.name ?? m.user.email,
              role: m.role,
              department: m.department,
            })),
          };
        },
      }),
  },

  agreements: {
    build: (ctx) =>
      tool({
        description:
          "Proposals and contracts — what has been sent, what is signed, what is still a draft, and what each is " +
          "worth. Use it for 'what is waiting on a signature', 'did they ever sign', and before drafting another one " +
          "for the same customer.",
        inputSchema: z.object({
          partyId: z.string().optional().describe("Only this customer's."),
          status: z.enum(["DRAFT", "SENT", "SIGNED", "DECLINED", "EXPIRED"]).optional(),
        }),
        execute: async ({ partyId, status }) => {
          const [rows, pipeline] = await Promise.all([
            listAgreements(ctx.tenantId, { partyId, status: status as AgreementState | undefined }),
            agreementPipeline(ctx.tenantId),
          ]);
          return {
            summary: pipeline,
            agreements: rows.map((a) => ({
              id: a.id,
              number: a.number,
              title: a.title,
              kind: a.kind,
              status: a.status,
              customer: a.party.companyName ?? a.party.name,
              customerId: a.partyId,
              valueCents: a.valueCents,
              recurrence: a.recurrence,
              starts: a.startsAt?.toISOString().slice(0, 10) ?? null,
              ends: a.endsAt?.toISOString().slice(0, 10) ?? null,
              signedBy: a.signerName,
              signedOn: a.signedAt?.toISOString().slice(0, 10) ?? null,
            })),
          };
        },
      }),
  },

  readAgreement: {
    build: (ctx) =>
      tool({
        description: "The full text of one proposal or contract, clause by clause. Use it when asked what a document actually says.",
        inputSchema: z.object({ agreementId: z.string() }),
        execute: async ({ agreementId }) => {
          const agreement = await getAgreement(ctx.tenantId, agreementId);
          if (!agreement) throw new Error("That agreement is not in this workspace.");
          return {
            number: agreement.number,
            title: agreement.title,
            kind: agreement.kind,
            status: agreement.status,
            customer: agreement.party.companyName ?? agreement.party.name,
            valueCents: agreement.valueCents,
            recurrence: agreement.recurrence,
            clauses: agreement.clauseList,
            signedBy: agreement.signerName,
            signedOn: agreement.signedAt?.toISOString().slice(0, 10) ?? null,
            // Worth saying out loud when it is false.
            wordingStillMatchesSignature: signatureStillMatches(agreement),
          };
        },
      }),
  },

  everythingAboutThem: {
    build: (ctx) =>
      tool({
        description:
          "Everything that has ever happened with one customer, in order: quotes, invoices, payments, emails both " +
          "ways, calls, what they sent from their portal, complaints, deliveries, agreements and notes. Read this " +
          "before phoning anybody, before chasing anybody, and whenever asked what is going on with a customer — it " +
          "is the one call that replaces six.",
        inputSchema: z.object({ partyId: z.string(), take: z.number().int().positive().default(60) }),
        execute: async ({ partyId, take }) => {
          const timeline = await customerTimeline(ctx.tenantId, partyId, { take });
          if (!timeline) throw new Error("That customer is not in this workspace.");
          return {
            customer: timeline.customer,
            summary: timeline.summary,
            entries: timeline.entries.map((e) => ({
              when: e.at.toISOString().slice(0, 10),
              what: e.kind,
              title: e.title,
              detail: e.detail,
              amountCents: e.amountCents ?? null,
              fromThem: Boolean(e.fromThem),
            })),
          };
        },
      }),
  },

  whoIsWaiting: {
    build: (ctx) =>
      tool({
        description:
          "Customer conversations nobody has answered, who owns each, and how long they have been waiting. Read it " +
          "when asked what needs doing, and before promising anybody that this business answers quickly.",
        inputSchema: z.object({ status: z.enum(["OPEN", "SNOOZED", "CLOSED"]).optional() }),
        execute: async ({ status }) => {
          const [list, health] = await Promise.all([
            listConversations(ctx.tenantId, { status }),
            responseHealth(ctx.tenantId),
          ]);
          return { howItIsGoing: health, conversations: list };
        },
      }),
  },

  conversationNotes: {
    build: (ctx) =>
      tool({
        description: "What the team has said about a conversation, as against in it. Never sent to the customer.",
        inputSchema: z.object({ threadKey: z.string() }),
        execute: async ({ threadKey }) => conversationNotes(ctx.tenantId, threadKey),
      }),
  },

  mayWeContact: {
    build: (ctx) =>
      tool({
        description:
          "Whether this business may message somebody on a channel, and why. Service messages about their own work " +
          "need no opt-in; anything they did not ask for does. Check before sending anything that is not about their " +
          "own invoice or job — a business that gets this wrong loses the channel.",
        inputSchema: z.object({
          partyId: z.string(),
          channel: z.enum(["whatsapp", "sms", "email", "call"]),
          purpose: z.enum(["service", "marketing"]).default("service"),
        }),
        execute: async ({ partyId, channel, purpose }) => {
          const [verdict, all] = await Promise.all([
            mayContact({ tenantId: ctx.tenantId, partyId, channel, purpose }),
            consentFor(ctx.tenantId, partyId),
          ]);
          return { ...verdict, onRecord: all };
        },
      }),
  },

  consentAcrossTheList: {
    build: (ctx) =>
      tool({
        description: "How many customers have opted in, opted out, or never been asked, per channel.",
        inputSchema: z.object({}),
        execute: async () => consentSummary(ctx.tenantId),
      }),
  },

  missedCalls: {
    build: (ctx) =>
      tool({
        description:
          "Calls that were missed and never followed up, and how often this business misses them. A missed call " +
          "nobody answers is the most expensive thing in a small business's day.",
        inputSchema: z.object({ days: z.number().int().positive().default(30) }),
        execute: async ({ days }) => {
          const [unanswered, health] = await Promise.all([
            unansweredMissedCalls(ctx.tenantId, new Date(Date.now() - days * 86_400_000)),
            callHealth(ctx.tenantId, days),
          ]);
          return {
            howItIsGoing: health,
            unanswered: unanswered.map((c) => ({
              id: c.id,
              from: c.fromNumber,
              who: c.party?.companyName ?? c.party?.name ?? null,
              partyId: c.partyId,
              at: c.startedAt.toISOString(),
            })),
          };
        },
      }),
  },

  callsWith: {
    build: (ctx) =>
      tool({
        description: "Every call logged with one customer, or the most recent across the workspace.",
        inputSchema: z.object({ partyId: z.string().optional() }),
        execute: async ({ partyId }) => listCalls(ctx.tenantId, { partyId }),
      }),
  },

  enquiries: {
    build: (ctx) =>
      tool({
        description:
          "Enquiries that came in through a form, and how quickly this business answers them — the number that " +
          "decides how many turn into work.",
        inputSchema: z.object({ onlyUnanswered: z.boolean().default(true) }),
        execute: async ({ onlyUnanswered }) => {
          const [rows, health, forms] = await Promise.all([
            listLeads(ctx.tenantId, onlyUnanswered ? { handled: false } : {}),
            leadResponseHealth(ctx.tenantId),
            listLeadForms(ctx.tenantId),
          ]);
          return {
            howItIsGoing: health,
            forms: forms.map((f) => ({ id: f.id, slug: f.slug, title: f.title, live: f.isActive, total: f.total, unanswered: f.unhandled })),
            enquiries: rows.map((r) => ({
              id: r.id,
              from: r.form.title,
              answers: r.answerList,
              customerId: r.partyId,
              at: r.createdAt.toISOString(),
              answered: Boolean(r.handledAt),
            })),
          };
        },
      }),
  },

  broadcastsSent: {
    build: (ctx) =>
      tool({
        description: "Messages sent to many people at once, with who was left out of each and why.",
        inputSchema: z.object({}),
        execute: async () => listBroadcasts(ctx.tenantId),
      }),
  },

  whoOwesWhatToSuppliers: {
    build: (ctx) =>
      tool({
        description:
          "What this business owes its suppliers and how late each one is — the mirror image of the debtors list, " +
          "and the half that decides whether a supplier keeps delivering. Read it for 'what does Friday cost' and " +
          "before agreeing to spend anything.",
        inputSchema: z.object({}),
        execute: async () => payablesSummary(ctx.tenantId),
      }),
  },

  supplierBills: {
    build: (ctx) =>
      tool({
        description: "Individual supplier invoices — what is awaiting approval, approved and waiting to be paid, or settled.",
        inputSchema: z.object({
          status: z.enum(["AWAITING_APPROVAL", "APPROVED", "PAID", "VOID"]).optional(),
          supplierId: z.string().optional(),
        }),
        execute: async ({ status, supplierId }) => {
          const bills = await listBills(ctx.tenantId, { status: status as BillStatus | undefined, supplierId });
          return bills.map((b) => ({
            id: b.id,
            supplier: b.supplier?.companyName ?? b.supplier?.name ?? b.supplierName,
            reference: b.reference,
            amountCents: b.amountCents,
            paidCents: b.paidCents,
            dueOn: b.dueOn.toISOString().slice(0, 10),
            status: b.status,
          }));
        },
      }),
  },

  paymentPlan: {
    build: (ctx) =>
      tool({
        description:
          "The agreed instalments on an invoice, and what of it is genuinely late today. Read this before saying an " +
          "invoice is overdue — somebody paying exactly as agreed is not late, whatever the invoice date says.",
        inputSchema: z.object({ invoiceId: z.string() }),
        execute: async ({ invoiceId }) => {
          const plan = await paymentPlanFor(ctx.tenantId, invoiceId);
          return plan ?? { plan: null, note: "There is no payment plan on that invoice." };
        },
      }),
  },

  whoToChase: {
    build: (ctx) =>
      tool({
        description:
          "Everybody who could be chased for money today, which rung of the ladder each is on, what the last message " +
          "said, and how that customer normally behaves. Anybody on a payment plan and up to date is listed with the " +
          "reason they are being skipped. Nothing is sent by reading this.",
        inputSchema: z.object({}),
        execute: async () => {
          const [list, effect] = await Promise.all([chaseList(ctx.tenantId), ladderEffect(ctx.tenantId)]);
          return {
            howItIsGoing: effect,
            candidates: list.map((c) => ({
              invoiceId: c.transactionId,
              number: c.number,
              customer: c.customer,
              customerId: c.partyId,
              outstandingCents: c.outstandingCents,
              daysLate: c.daysLate,
              nextRung: c.rung ? { step: c.rung.step, tone: c.rung.tone, label: c.rung.label, why: c.rung.intent } : null,
              chasedBefore: c.attemptsSoFar,
              lastChasedAt: c.lastAttemptAt?.toISOString().slice(0, 10) ?? null,
              theyUsuallyPayOnTime: c.history.usuallyOnTime,
              skipBecause: c.skip,
            })),
          };
        },
      }),
  },

  chasingHistory: {
    build: (ctx) =>
      tool({
        description: "Every message already sent chasing one invoice, so the next one does not repeat the last.",
        inputSchema: z.object({ invoiceId: z.string() }),
        execute: async ({ invoiceId }) => chaseHistory(ctx.tenantId, invoiceId),
      }),
  },

  vatReturn: {
    build: (ctx) =>
      tool({
        description:
          "The VAT return for a period: every box, what was counted in it, and the caveats. Use it for 'what do we " +
          "owe SARS' and before agreeing to spend money that is really the revenue service's. Leave the dates out " +
          "for the period covering today.",
        inputSchema: z.object({
          periodStart: z.string().optional().describe("YYYY-MM-DD"),
          periodEnd: z.string().optional().describe("YYYY-MM-DD"),
        }),
        execute: async ({ periodStart, periodEnd }) => {
          const period =
            periodStart && periodEnd
              ? { start: new Date(periodStart), end: new Date(periodEnd) }
              : vatPeriodFor(new Date());
          const [computed, filed] = await Promise.all([
            computeVatReturn(ctx.tenantId, period.start, period.end),
            listVatReturns(ctx.tenantId),
          ]);
          return {
            period: { from: period.start.toISOString().slice(0, 10), to: period.end.toISOString().slice(0, 10) },
            boxes: computed.boxes,
            netCents: computed.netCents,
            payable: computed.netCents > 0,
            caveats: computed.caveats,
            alreadyFiled: filed
              .filter((f) => f.status === "FILED")
              .map((f) => ({ from: f.periodStart.toISOString().slice(0, 10), netCents: f.netCents, reference: f.reference })),
          };
        },
      }),
  },

  foreignCurrencyPosition: {
    build: (ctx) =>
      tool({
        description:
          "Gain and loss on invoices issued in another currency and since settled — real money made or lost by the " +
          "rate moving between issue and payment, which nothing else in the books shows.",
        inputSchema: z.object({}),
        execute: async () => {
          const position = await fxPosition(ctx.tenantId);
          return { ...position, rows: position.rows.slice(0, 20) };
        },
      }),
  },

  whichWorkLosesMoney: {
    build: (ctx) =>
      tool({
        description:
          "Margin grouped by the kind of work rather than by job — which sort of job is quietly losing money. A " +
          "business rarely loses it evenly; it loses it on one kind, and the total hides it. The question owners " +
          "most want answered.",
        inputSchema: z.object({ days: z.number().int().positive().default(365) }),
        execute: async ({ days }) => {
          const report = await workKindMargins(ctx.tenantId, lastDays(days));
          return {
            finding: report.finding,
            kinds: report.kinds.map((k) => ({
              kind: k.label,
              jobs: k.jobs,
              revenueCents: k.revenueCents,
              marginCents: k.marginCents,
              marginPercent: k.marginPercent,
              lossMaking: k.lossMaking,
              worstJob: k.worst,
            })),
          };
        },
      }),
  },

  howCostsAreCoded: {
    build: (ctx) =>
      tool({
        description:
          "What this workspace has taught the system about coding its costs — which supplier goes to which account, " +
          "and how often each rule has been used. A rule never used is one worth removing.",
        inputSchema: z.object({}),
        execute: async () => listCodingRules(ctx.tenantId),
      }),
  },

  bankFeeds: {
    build: (ctx) =>
      tool({
        description:
          "Whether each bank account is fed automatically or imported by hand, when it last updated, and whether a " +
          "connected feed is actually working. Check it before trusting a bank balance or a reconciliation.",
        inputSchema: z.object({}),
        execute: async () => feedStatus(ctx.tenantId),
      }),
  },

  customerComplaints: {
    build: (ctx) =>
      tool({
        description:
          "What customers have said is wrong with a quote or an invoice, raised from their own portal — what is " +
          "still open, how long each has been waiting, and how quickly this business usually settles them. Read it " +
          "before chasing a customer for money: somebody disputing half an invoice is not somebody ignoring it.",
        inputSchema: z.object({
          status: z.enum(["OPEN", "RESOLVED"]).optional(),
          partyId: z.string().optional(),
        }),
        execute: async ({ status, partyId }) => {
          const [rows, health] = await Promise.all([
            listDisputes(ctx.tenantId, { status: status as DisputeStatus | undefined, partyId }),
            disputeHealth(ctx.tenantId),
          ]);
          return {
            summary: health,
            complaints: rows.map((d) => ({
              id: d.id,
              customer: d.partyName,
              customerId: d.partyId,
              about: d.documentType,
              documentId: d.transactionId,
              amountCents: d.amountCents,
              said: d.message,
              status: d.status,
              openDays: d.ageDays,
              settledWith: d.resolutionNote,
            })),
          };
        },
      }),
  },

  theNumbers: {
    build: (ctx) =>
      tool({
        description:
          "Every figure on this person's home dashboard, grouped the way it is grouped there — money, selling, " +
          "work, stock, people, the road, deadlines — narrowed to what their role may see and what this trade " +
          "actually has. Use it for 'how are we doing', for any question spanning more than one part of the " +
          "business, and to answer with the same numbers the screen in front of them is showing.",
        inputSchema: z.object({}),
        execute: async () => {
          const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { niche: true } });
          const board = await kpiBoard(ctx.tenantId, ctx.role, tenant.niche);
          return {
            scope: board.scope,
            groups: board.groups.map((g) => ({
              area: g.title,
              figures: g.panels.map((p) => ({
                name: p.title,
                value: p.value ?? null,
                changePercent: p.deltaPercent ?? null,
                means: p.note ?? null,
                // The series and slices matter for a question about direction
                // rather than level — "is it getting better" needs the shape.
                byMonth: p.series ?? null,
                breakdown: p.slices?.map((s) => ({ name: s.name, value: s.value })) ?? null,
              })),
            })),
          };
        },
      }),
  },

  whatElseTheyRun: {
    build: (ctx) =>
      tool({
        description:
          "The other systems this business still uses — till, accounting package, online shop, spreadsheets — how " +
          "much of the business actually runs here yet, and the specific things this workspace cannot do because the " +
          "data is still somewhere else. Read it before claiming a figure is complete, before suggesting a report " +
          "that depends on data nobody has brought over, and when asked what to set up next.",
        inputSchema: z.object({}),
        execute: async () => {
          const [systems, move] = await Promise.all([listSystems(ctx.tenantId), switchover(ctx.tenantId)]);
          return {
            percentOnFlow: move.percent,
            working: move.onFlow,
            // Each of these is something a figure here is currently wrong about.
            cannotDoYet: move.gaps.map((g) => ({ what: g.missing, needs: g.needs, heldBy: g.heldBy ?? null })),
            systems: systems.map((s) => ({
              key: s.systemKey,
              name: s.label ?? s.def.label,
              category: s.category,
              recordsStillLiveThere: s.isSystemOfRecord && !s.retiredAt,
              movedOffOn: s.retiredAt?.toISOString().slice(0, 10) ?? null,
              broughtOver: s.importedRecords,
              howToBringItOver: s.def.exportPath ?? null,
            })),
          };
        },
      }),
  },

  agreementTemplates: {
    build: () =>
      tool({
        description: "The kinds of proposal and contract that can be started from a template, and what each is for.",
        inputSchema: z.object({}),
        execute: async () =>
          AGREEMENT_TEMPLATES.map((t) => ({ key: t.key, kind: t.kind, label: t.label, purpose: t.purpose })),
      }),
  },

  customerPortalMessages: {
    build: (ctx) =>
      tool({
        description:
          "What customers have sent in from their own portal link and nobody has dealt with yet — proof of " +
          "payment, questions about an invoice, and corrections to their own details. Check this when asked " +
          "what customers are waiting on, or before chasing someone who says they have already paid.",
        inputSchema: z.object({
          includeHandled: z.boolean().default(false).describe("Also show ones already dealt with."),
        }),
        execute: async ({ includeHandled }) => {
          const rows = await listSubmissions(ctx.tenantId, includeHandled ? {} : { handled: false });
          return rows.map((s) => ({
            id: s.id,
            customer: s.party.name,
            customerId: s.partyId,
            kind: s.kind,
            says: s.body,
            attached: Boolean(s.fileDataUrl),
            aboutDocumentId: s.transactionId,
            when: s.createdAt.toISOString().slice(0, 10),
            dealtWith: s.handledAt ? s.handledAt.toISOString().slice(0, 10) : null,
          }));
        },
      }),
  },
};

// ------------------------------------------------------------------ writing

export const EXTRA_WRITE_TOOLS: Record<string, ExtraToolDef> = {
  // The agent's own long-term memory. src/lib/agent/memory.ts has loaded
  // these into every system prompt since the day it shipped — and nothing
  // ever wrote one, so "what you already know about this business" was an
  // empty list forever and the agent started every morning as a stranger.
  rememberFact: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Remember something durable about this business that no query could tell you later: " +
          "how a customer prefers to be contacted, why a supplier is slow, a standing " +
          "arrangement, a name you were corrected on. Use a short stable key so the same " +
          "subject updates rather than piling up. Do NOT store things you could look up " +
          "again (balances, statuses, counts) — those go stale and then mislead you.",
        inputSchema: z.object({
          key: z
            .string()
            .describe('short, stable, e.g. "riverside-payment-terms" or "owner-preferred-tone"'),
          value: z.string().describe("the fact, in one sentence"),
        }),
        execute: async ({ key, value }) => {
          await rememberFact({ tenantId: ctx.tenantId, key, value, confidence: "observed" });
          return { ok: true, key };
        },
      }),
  },

  forgetFact: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Drop something you had remembered, once you find it is wrong or no longer true. " +
          "Correcting a fact is better than working around it.",
        inputSchema: z.object({ key: z.string() }),
        execute: async ({ key }) => {
          await forgetFact(ctx.tenantId, key);
          return { ok: true };
        },
      }),
  },

  addNote: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Record a note against a customer, quote, invoice or job — what was said, what was " +
          "agreed, what to remember.",
        inputSchema: z.object({
          entityType: z.string().describe("e.g. Party, Transaction, JobCard"),
          entityId: z.string(),
          body: z.string(),
        }),
        execute: async ({ entityType, entityId, body }) => {
          // Notes are attributed; an agent acting with no staff account has
          // nobody to attribute to, and an unattributed note is worse than none.
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          const note = await addNote({
            tenantId: ctx.tenantId,
            entityType,
            entityId,
            body,
            authorId: ctx.membershipId,
          });
          return { noteId: note.id };
        },
      }),
  },

  addComment: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Leave a comment for the team on a record — a question, a hand-off, context someone " +
          "else will need. Internal only; the customer never sees it.",
        inputSchema: z.object({
          entityType: z.string().describe("e.g. Party, Transaction, JobCard"),
          entityId: z.string(),
          body: z.string(),
        }),
        execute: async ({ entityType, entityId, body }) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          const c = await addComment({
            tenantId: ctx.tenantId,
            entityType,
            entityId,
            authorId: ctx.membershipId,
            body,
          });
          return { commentId: c.id };
        },
      }),
  },

  setFollowUpReminder: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Set a reminder to chase a specific quote or invoice on a date. This is how you " +
          "'make sure we follow up on Thursday' without messaging the customer now.",
        inputSchema: z.object({
          transactionId: z.string(),
          remindAtIso: z.string().describe("ISO 8601 datetime"),
          note: z.string().optional(),
        }),
        execute: async ({ transactionId, remindAtIso, note }) => {
          await setManualReminder({
            tenantId: ctx.tenantId,
            transactionId,
            remindAt: new Date(remindAtIso),
            note,
          });
          return { ok: true };
        },
      }),
  },

  clearFollowUpReminder: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description: "Cancel a follow-up reminder on a quote or invoice.",
        inputSchema: z.object({ transactionId: z.string() }),
        execute: async ({ transactionId }) => {
          await clearManualReminder(ctx.tenantId, transactionId);
          return { ok: true };
        },
      }),
  },

  createJobCard: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Raise a work order against a job, with an optional checklist. Resolve the customer " +
          "and the transaction first.",
        inputSchema: z.object({
          transactionId: z.string(),
          customerId: z.string(),
          title: z.string(),
          assignedToId: z.string().optional().describe("membership id from listStaff"),
          scheduledAtIso: z.string().optional(),
          taskLabels: z.array(z.string()).optional(),
        }),
        execute: async ({ transactionId, customerId, title, assignedToId, scheduledAtIso, taskLabels }) => {
          const card = await createJobCard({
            tenantId: ctx.tenantId,
            transactionId,
            partyId: customerId,
            title,
            assignedToId,
            scheduledAt: scheduledAtIso ? new Date(scheduledAtIso) : undefined,
            taskLabels,
          });
          return { jobCardId: card.id };
        },
      }),
  },

  setJobCardStatus: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Move a job card to SCHEDULED, IN_PROGRESS or DONE.",
        inputSchema: z.object({
          jobCardId: z.string(),
          status: z.enum(["SCHEDULED", "IN_PROGRESS", "DONE"]),
        }),
        execute: async ({ jobCardId, status }) => {
          await setJobCardStatus(ctx.tenantId, jobCardId, status);
          return { ok: true };
        },
      }),
  },

  completeJobCard: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Mark a job card done. Refuses while checklist items are still unticked — that's " +
          "deliberate, not a bug.",
        inputSchema: z.object({ jobCardId: z.string() }),
        execute: async ({ jobCardId }) => {
          await completeJobCard(ctx.tenantId, jobCardId);
          return { ok: true };
        },
      }),
  },

  logDelivery: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description: "Record that a delivery or site visit happened.",
        inputSchema: z.object({
          customerId: z.string(),
          notes: z.string().optional(),
          fromAcceptedQuoteId: z.string().optional(),
        }),
        execute: async ({ customerId, notes, fromAcceptedQuoteId }) => {
          const event = await logDelivery({
            tenantId: ctx.tenantId,
            partyId: customerId,
            notes,
            fromAcceptedQuoteId,
          });
          return { eventId: event.id };
        },
      }),
  },

  approveExpense: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Approve a staff expense claim.",
        inputSchema: z.object({ expenseId: z.string() }),
        execute: async ({ expenseId }) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          await approveExpense(ctx.tenantId, expenseId, ctx.membershipId);
          return { ok: true };
        },
      }),
  },

  rejectExpense: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description: "Reject a staff expense claim.",
        inputSchema: z.object({ expenseId: z.string() }),
        execute: async ({ expenseId }) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          await rejectExpense(ctx.tenantId, expenseId, ctx.membershipId);
          return { ok: true };
        },
      }),
  },

  submitExpense: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Submit an expense claim on behalf of the signed-in staff member.",
        inputSchema: z.object({
          descriptionText: z.string(),
          amountCents: z.number().int().positive(),
          category: z.string().optional(),
        }),
        execute: async (input) => {
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          const e = await submitExpense({
            tenantId: ctx.tenantId,
            submittedById: ctx.membershipId,
            ...input,
          });
          return { expenseId: e.id };
        },
      }),
  },

  createGoal: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Set a target for the business to track against.",
        inputSchema: z.object({
          title: z.string(),
          metricLabel: z.string().describe("What is being counted, e.g. 'invoices paid'"),
          targetValue: z.number(),
          dueDateIso: z.string().optional(),
        }),
        execute: async ({ title, metricLabel, targetValue, dueDateIso }) => {
          const g = await createGoal({
            tenantId: ctx.tenantId,
            title,
            metricLabel,
            targetValue,
            dueDate: dueDateIso ? new Date(dueDateIso) : undefined,
          });
          return { goalId: g.id };
        },
      }),
  },

  updateGoalProgress: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Update how far along a goal is.",
        inputSchema: z.object({ goalId: z.string(), currentValue: z.number() }),
        execute: async ({ goalId, currentValue }) => {
          await updateGoalProgress(goalId, currentValue, ctx.tenantId);
          return { ok: true };
        },
      }),
  },

  recordStocktake: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Record a physical stock count. The difference against the expected figure becomes " +
          "the shrinkage report.",
        inputSchema: z.object({
          itemId: z.string(),
          countedQty: z.number().int().min(0),
        }),
        execute: async ({ itemId, countedQty }) => {
          // A count has to be attributable — the whole point of the shrinkage
          // report is knowing who counted what.
          if (!ctx.membershipId) throw new Error("No staff account on this workspace.");
          await recordStocktake({
            tenantId: ctx.tenantId,
            itemId,
            countedQty,
            countedById: ctx.membershipId,
          });
          return { ok: true };
        },
      }),
  },

  markPurchaseOrderReceived: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description: "Mark a purchase order as delivered, which moves the stock in.",
        inputSchema: z.object({ purchaseOrderId: z.string() }),
        execute: async ({ purchaseOrderId }) => {
          await markPurchaseOrderReceived(ctx.tenantId, purchaseOrderId);
          return { ok: true };
        },
      }),
  },

  returnRental: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Close out a rental. Generates the invoice for the actual duration used, not the " +
          "originally estimated one.",
        inputSchema: z.object({ rentalId: z.string() }),
        execute: async ({ rentalId }) => {
          const invoice = await returnRental(rentalId, ctx.tenantId);
          return { invoiceId: invoice.id, amountCents: invoice.amountCents };
        },
      }),
  },

  applyLateFee: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Add a late fee to an overdue invoice. Customer-visible on their statement, so only " +
          "when clearly asked.",
        inputSchema: z.object({
          invoiceId: z.string(),
          feePercent: z.number().positive().default(5),
        }),
        execute: async ({ invoiceId, feePercent }) => {
          await applyLateFee({ invoiceId, feePercent, tenantId: ctx.tenantId });
          return { ok: true };
        },
      }),
  },

  assignConversation: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Put somebody's name against a customer conversation so it stops being everybody's and therefore nobody's. " +
          "Leave the person out to unassign it.",
        inputSchema: z.object({ threadKey: z.string(), membershipId: z.string().optional() }),
        execute: async ({ threadKey, membershipId }) => {
          await assign({ tenantId: ctx.tenantId, threadKey, membershipId: membershipId ?? null });
          return { ok: true };
        },
      }),
  },

  snoozeConversation: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Put a conversation out of the way until a date, then bring it back. For the things that are genuinely not " +
          "due yet — the alternative is leaving them looking urgent until they are ignored with everything else.",
        inputSchema: z.object({ threadKey: z.string(), until: z.string().describe("YYYY-MM-DD") }),
        execute: async ({ threadKey, until }) => {
          await snooze({ tenantId: ctx.tenantId, threadKey, until: new Date(until) });
          return { ok: true };
        },
      }),
  },

  closeConversation: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Mark a customer conversation done. It reopens by itself if they write again.",
        inputSchema: z.object({ threadKey: z.string() }),
        execute: async ({ threadKey }) => {
          await closeConversation({ tenantId: ctx.tenantId, threadKey, closedById: ctx.membershipId ?? null });
          return { ok: true };
        },
      }),
  },

  noteOnConversation: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Say something about a conversation for whoever picks it up next. Never sent to the customer — the thing " +
          "somebody needs to say about a customer is rarely the thing they would say to them.",
        inputSchema: z.object({ threadKey: z.string(), body: z.string() }),
        execute: async ({ threadKey, body }) => {
          await addConversationNote({ tenantId: ctx.tenantId, threadKey, body, authorId: ctx.membershipId ?? null });
          return { ok: true };
        },
      }),
  },

  recordConsent: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Write down that somebody agreed to be contacted on a channel, or asked not to be. Record where it came " +
          "from — that is what makes it defensible. Always record a withdrawal immediately; it is the one that " +
          "matters legally and the one that loses a business its number.",
        inputSchema: z.object({
          partyId: z.string(),
          channel: z.enum(["whatsapp", "sms", "email", "call"]),
          state: z.enum(["granted", "withdrawn"]),
          source: z.string().optional().describe("Where it came from — a form, a reply, a conversation."),
        }),
        execute: async ({ partyId, channel, state, source }) => {
          await setConsent({ tenantId: ctx.tenantId, partyId, channel: channel as Channel, state, source: source ?? null });
          return { ok: true, channels: CHANNELS };
        },
      }),
  },

  answerMissedCall: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Work out what to send somebody whose call was missed, and check they may be messaged. It writes the " +
          "wording and records nothing — answering within the minute is the highest-return thing a small business " +
          "does, but the speaking is still a person's.",
        inputSchema: z.object({ callId: z.string() }),
        execute: async ({ callId }) => handleMissedCall({ tenantId: ctx.tenantId, callId }),
      }),
  },

  logACall: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description:
          "Write down a call that happened — who, which way, whether it was answered, and what was said. Matched to " +
          "the customer on file by number, so it lands on their timeline.",
        inputSchema: z.object({
          fromNumber: z.string(),
          toNumber: z.string(),
          direction: z.enum(["in", "out"]),
          status: z.enum(["answered", "missed", "voicemail"]),
          durationSeconds: z.number().int().nonnegative().optional(),
          summary: z.string().optional(),
        }),
        execute: async ({ fromNumber, toNumber, direction, status, durationSeconds, summary }) => {
          const call = await logCall({
            tenantId: ctx.tenantId,
            fromNumber,
            toNumber,
            direction,
            status,
            durationSeconds: durationSeconds ?? null,
            summary: summary ?? null,
          });
          return { ok: true, callId: call.id, matchedCustomer: call.partyId };
        },
      }),
  },

  markCallAnswered: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Record that a missed call was followed up, however it was followed up.",
        inputSchema: z.object({ callId: z.string(), how: z.string() }),
        execute: async ({ callId, how }) => {
          await markCallResponded({ tenantId: ctx.tenantId, callId, with: how });
          return { ok: true };
        },
      }),
  },

  makeEnquiryForm: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Make a form a stranger can fill in, with an answer that goes back the second they do. Speed is most of " +
          "why one business wins a job and the one down the road does not.",
        inputSchema: z.object({
          title: z.string(),
          intro: z.string().optional(),
          autoReply: z.string().optional().describe("What they see the moment they submit."),
        }),
        execute: async ({ title, intro, autoReply }) => {
          const form = await createLeadForm({
            tenantId: ctx.tenantId,
            title,
            intro: intro ?? null,
            autoReply: autoReply ?? null,
          });
          const base = process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com";
          return { ok: true, formId: form.id, link: `${base}/enquire/${ctx.tenantId}/${form.slug}` };
        },
      }),
  },

  markEnquiryAnswered: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Mark an enquiry as dealt with, so the unanswered list means something.",
        inputSchema: z.object({ submissionId: z.string() }),
        execute: async ({ submissionId }) => {
          await markLeadHandled(ctx.tenantId, submissionId);
          return { ok: true };
        },
      }),
  },

  planABroadcast: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Assemble a message to many people and see exactly who would receive it and who would be left out, with " +
          "the reason for each. Nothing is sent by this — releasing a broadcast is a separate act a person takes " +
          "after reading the skipped list.",
        inputSchema: z.object({
          channel: z.enum(["whatsapp", "sms", "email"]),
          purpose: z.enum(["service", "marketing"]).default("marketing"),
          subject: z.string().optional(),
          body: z.string(),
          partyIds: z.array(z.string()).optional().describe("Leave out for every customer on file."),
        }),
        execute: async ({ channel, purpose, subject, body, partyIds }) => {
          const preview = await previewAudience({ tenantId: ctx.tenantId, channel, purpose, partyIds });
          const draft = await draftBroadcast({
            tenantId: ctx.tenantId,
            channel,
            purpose,
            subject: subject ?? null,
            body,
            partyIds,
            createdById: ctx.membershipId ?? null,
          });
          return {
            broadcastId: draft.id,
            summary: preview.summary,
            willReach: preview.willReceive.length,
            leftOut: preview.skipped.slice(0, 30),
            note: "Nothing has been sent. Somebody has to release it after reading who is left out.",
          };
        },
      }),
  },

  agreePaymentPlan: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Write down instalments a customer has agreed on an invoice — 'half now, half end of month'. This is what " +
          "stops the chaser going out to somebody paying exactly as agreed, and what makes the arrears figure true. " +
          "The deposit plus the instalments must come to the invoice total.",
        inputSchema: z.object({
          invoiceId: z.string(),
          depositCents: z.number().int().nonnegative().default(0),
          instalments: z.number().int().positive().describe("How many, after the deposit."),
          firstDueOn: z.string().describe("YYYY-MM-DD"),
          every: z.enum(["weekly", "fortnightly", "monthly"]).default("monthly"),
          note: z.string().optional(),
        }),
        execute: async ({ invoiceId, depositCents, instalments, firstDueOn, every, note }) => {
          const invoice = await prisma.transaction.findFirst({
            where: { id: invoiceId, tenantId: ctx.tenantId, type: "INVOICE" },
            select: { amountCents: true },
          });
          if (!invoice) throw new Error("That invoice is not in this workspace.");

          const plan = await createPaymentPlan({
            tenantId: ctx.tenantId,
            transactionId: invoiceId,
            depositCents,
            note: note ?? null,
            agreedById: ctx.membershipId ?? null,
            instalments: evenInstalments({
              totalCents: invoice.amountCents - depositCents,
              count: instalments,
              firstDueOn: new Date(firstDueOn),
              every,
            }),
          });
          return { ok: true, planId: plan.id, instalments: plan.instalments.length };
        },
      }),
  },

  cancelPaymentPlan: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Cancel a payment plan. From then the whole outstanding amount is due and chased as normal.",
        inputSchema: z.object({ invoiceId: z.string() }),
        execute: async ({ invoiceId }) => {
          await cancelPaymentPlan(ctx.tenantId, invoiceId);
          return { ok: true };
        },
      }),
  },

  recordSupplierBill: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Record a supplier's invoice that has not been paid yet, with the date it must be. This is what makes the " +
          "payables list and the cash forecast see money going out before it goes.",
        inputSchema: z.object({
          supplierId: z.string().optional(),
          supplierName: z.string().optional().describe("The name off the invoice when the supplier is not on file."),
          reference: z.string().optional(),
          amountCents: z.number().int().positive(),
          taxCents: z.number().int().nonnegative().optional(),
          dueOn: z.string().describe("YYYY-MM-DD"),
          issuedOn: z.string().optional().describe("YYYY-MM-DD"),
          notes: z.string().optional(),
        }),
        execute: async ({ supplierId, supplierName, reference, amountCents, taxCents, dueOn, issuedOn, notes }) => {
          const bill = await recordBill({
            tenantId: ctx.tenantId,
            supplierId: supplierId ?? null,
            supplierName: supplierName ?? null,
            reference: reference ?? null,
            amountCents,
            taxCents: taxCents ?? null,
            dueOn: new Date(dueOn),
            issuedOn: issuedOn ? new Date(issuedOn) : undefined,
            notes: notes ?? null,
          });
          return { ok: true, billId: bill.id, status: bill.status };
        },
      }),
  },

  approveSupplierBill: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Approve a supplier bill for payment. It can then go into a payment run.",
        inputSchema: z.object({ billId: z.string() }),
        execute: async ({ billId }) => {
          const bill = await approveBill(ctx.tenantId, billId, ctx.membershipId ?? null);
          return { ok: true, status: bill.status };
        },
      }),
  },

  paySupplierBill: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description:
          "Record that a supplier bill has been paid. This writes the cost to the books — money that has gone, " +
          "rather than money that must go — so only do it once it has actually left the account.",
        inputSchema: z.object({
          billId: z.string(),
          amountCents: z.number().int().positive().optional().describe("Leave it out to settle the whole bill."),
          paidOn: z.string().optional().describe("YYYY-MM-DD"),
        }),
        execute: async ({ billId, amountCents, paidOn }) => {
          if (!ctx.membershipId) throw new Error("A cost has to be recorded by somebody.");
          const bill = await payBill({
            tenantId: ctx.tenantId,
            billId,
            amountCents,
            paidOn: paidOn ? new Date(paidOn) : undefined,
            submittedById: ctx.membershipId,
          });
          return { ok: true, paidCents: bill.paidCents, status: bill.status };
        },
      }),
  },

  buildPaymentRun: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description:
          "Gather every approved bill due by a date into one batch, ready to be released. Building the run pays " +
          "nothing — releasing it does.",
        inputSchema: z.object({ runOn: z.string().describe("YYYY-MM-DD"), dueBefore: z.string().optional() }),
        execute: async ({ runOn, dueBefore }) =>
          buildPaymentRun({
            tenantId: ctx.tenantId,
            runOn: new Date(runOn),
            dueBefore: dueBefore ? new Date(dueBefore) : undefined,
            createdById: ctx.membershipId ?? null,
          }),
      }),
  },

  draftTheChase: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Write the next chasing message for an invoice, at the rung the ladder says it is on and in the tone that " +
          "goes with it. It writes the words and records nothing — sending is a separate step, and the wording " +
          "should be read back to whoever asked first.",
        inputSchema: z.object({ invoiceId: z.string() }),
        execute: async ({ invoiceId }) => {
          const [list, tenant] = await Promise.all([
            chaseList(ctx.tenantId),
            prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, currency: true } }),
          ]);
          const candidate = list.find((c) => c.transactionId === invoiceId);
          if (!candidate) throw new Error("That invoice is not one of the ones outstanding.");
          if (candidate.skip) return { skip: candidate.skip };
          if (!candidate.rung) return { skip: "It is not far enough past its date for the next message yet." };

          const party = await prisma.party.findUnique({ where: { id: candidate.partyId }, select: { portalToken: true } });
          const base = process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com";
          const draft = draftChase({
            candidate,
            businessName: tenant.name,
            currency: tenant.currency,
            portalUrl: party?.portalToken ? `${base}/portal/${party.portalToken}` : null,
          });
          return { ...draft, customer: candidate.customer, outstandingCents: candidate.outstandingCents };
        },
      }),
  },

  recordTheChase: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Write down that a chasing message went out, so the next one knows which rung was reached. Record it after " +
          "it has actually been sent, whichever way it went.",
        inputSchema: z.object({
          invoiceId: z.string(),
          step: z.number().int().positive(),
          channel: z.enum(["whatsapp", "email", "call", "letter"]),
          tone: z.enum(["gentle", "firm", "final"]),
          body: z.string().optional(),
        }),
        execute: async ({ invoiceId, step, channel, tone, body }) => {
          await recordChase({
            tenantId: ctx.tenantId,
            transactionId: invoiceId,
            step,
            channel,
            tone,
            body: body ?? null,
            sentById: ctx.membershipId ?? null,
          });
          return { ok: true };
        },
      }),
  },

  saveVatReturn: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description:
          "Save the working figures for a VAT period so a part-finished return survives. This does not file it — " +
          "filing is a person's decision and freezes the numbers for good.",
        inputSchema: z.object({ periodStart: z.string().optional(), periodEnd: z.string().optional() }),
        execute: async ({ periodStart, periodEnd }) => {
          const period =
            periodStart && periodEnd ? { start: new Date(periodStart), end: new Date(periodEnd) } : vatPeriodFor(new Date());
          const saved = await saveDraftReturn(ctx.tenantId, period.start, period.end);
          return { ok: true, id: saved.id, netCents: saved.netCents, status: saved.status };
        },
      }),
  },

  rememberHowToCodeThis: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Remember that costs from this supplier are coded a particular way, so the same correction is not needed " +
          "every month. Use it when somebody fixes a coded cost and says how it should have been.",
        inputSchema: z.object({
          supplierName: z.string().optional(),
          description: z.string().optional(),
          accountId: z.string().optional(),
          category: z.string().optional(),
          isOwnerDrawing: z.boolean().optional(),
        }),
        execute: async ({ supplierName, description, accountId, category, isOwnerDrawing }) => {
          const rule = await rememberCorrection({
            tenantId: ctx.tenantId,
            supplierName: supplierName ?? null,
            description: description ?? null,
            accountId: accountId ?? undefined,
            category: category ?? undefined,
            isOwnerDrawing: isOwnerDrawing ?? undefined,
          });
          return rule
            ? { ok: true, remembered: rule.matchOn }
            : { ok: false, note: "There was not enough to key a rule on, or nothing to remember." };
        },
      }),
  },

  forgetHowToCodeThis: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description: "Remove a coding rule that is getting it wrong.",
        inputSchema: z.object({ ruleId: z.string() }),
        execute: async ({ ruleId }) => forgetCodingRule(ctx.tenantId, ruleId),
      }),
  },

  codeThisCost: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Apply what this workspace already knows to a cost that has just come in. Only fills what is empty — it " +
          "never overwrites something a person set.",
        inputSchema: z.object({ expenseId: z.string() }),
        execute: async ({ expenseId }) => applyCoding(ctx.tenantId, expenseId),
      }),
  },

  setExchangeRate: {
    capability: "invoice:create",
    build: () =>
      tool({
        description:
          "Record the rate between two currencies on a day. Used to price a foreign invoice at issue and to work " +
          "out the gain or loss when it settles.",
        inputSchema: z.object({
          base: z.string().describe("Three-letter code, e.g. USD"),
          quote: z.string().describe("Three-letter code, e.g. ZAR"),
          rate: z.number().positive(),
          onDate: z.string().optional().describe("YYYY-MM-DD, or leave out for today"),
        }),
        execute: async ({ base, quote, rate, onDate }) => {
          const saved = await setRate({ base, quote, rate, onDate: onDate ? new Date(onDate) : undefined });
          return { ok: true, base: saved.base, quote: saved.quote, rate: saved.rate, onDate: saved.onDate.toISOString().slice(0, 10) };
        },
      }),
  },

  setCustomerCurrency: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Set the currency a customer is billed in, so their documents come out in it without anybody remembering " +
          "to switch each time. Leave the currency out to put them back on the workspace's own.",
        inputSchema: z.object({ partyId: z.string(), currency: z.string().optional() }),
        execute: async ({ partyId, currency }) => {
          await setCustomerCurrency(ctx.tenantId, partyId, currency ?? null);
          return { ok: true, currency: await currencyForCustomer(ctx.tenantId, partyId) };
        },
      }),
  },

  syncBankFeed: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description:
          "Pull whatever is new from a connected bank feed and put it through the ordinary import. Says plainly when " +
          "nothing could be fetched rather than reporting a quiet zero.",
        inputSchema: z.object({ bankAccountId: z.string() }),
        execute: async ({ bankAccountId }) => syncFeed({ tenantId: ctx.tenantId, bankAccountId }),
      }),
  },

  settleComplaint: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Mark a customer's complaint settled, with a note of what was done about it. Use it once something has " +
          "actually been done — a complaint closed without an answer is a customer who stops replying.",
        inputSchema: z.object({
          disputeId: z.string(),
          whatWasDone: z.string().optional(),
          reopen: z.boolean().default(false).describe("Put it back to open, when it was settled too early."),
        }),
        execute: async ({ disputeId, whatWasDone, reopen }) => {
          const updated = await resolveDispute({ tenantId: ctx.tenantId, disputeId, note: whatWasDone ?? null, reopen });
          return { ok: true, status: updated.status };
        },
      }),
  },

  addSomebodyToTheTeam: {
    capability: "staff:manage",
    build: (ctx) =>
      tool({
        description:
          "Put somebody on this workspace and email them an invitation. Use their real role — a driver and a rep " +
          "see different things, and getting it wrong either blocks their work or shows them the books. Somebody " +
          "already here has their role changed rather than being added twice.",
        inputSchema: z.object({
          email: z.string(),
          name: z.string().optional(),
          role: z.enum(["OWNER", "STAFF", "REP", "TECHNICIAN", "DRIVER"]).default("STAFF"),
        }),
        execute: async ({ email, name, role }) => {
          const result = await inviteStaff({
            tenantId: ctx.tenantId,
            email,
            name: name ?? null,
            role,
            actorId: ctx.userId ?? null,
          });
          return {
            ok: true,
            ...result,
            // Said rather than hidden: an invitation nobody received is not
            // an invitation, and the person is on the workspace either way.
            note: result.emailed
              ? result.alreadyHere
                ? "They were already here; their role was changed and they were told."
                : "Added and emailed."
              : "Added, but the invitation email did not send — tell them yourself.",
          };
        },
      }),
  },

  recordCashSale: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description:
          "A walk-in sale, recorded in one step: the invoice and the payment together, for a customer standing at " +
          "the counter. Everything else about it is an ordinary invoice, so it reaches the books, the stock and the " +
          "day's takings the same way.",
        inputSchema: z.object({
          partyId: z.string().describe("Who bought it. Create a customer first if they are not on file."),
          lines: z
            .array(
              z.object({
                itemId: z.string(),
                quantity: z.number().positive(),
                unitPriceCents: z.number().int().nonnegative(),
                description: z.string().optional(),
              })
            )
            .min(1),
        }),
        execute: async ({ partyId, lines }) => {
          const invoice = await recordCashSale({ tenantId: ctx.tenantId, partyId, lines });
          return { ok: true, invoiceId: invoice.id, amountCents: invoice.amountCents, status: invoice.status };
        },
      }),
  },

  noteAnotherSystem: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Write down that this business uses another system — a till, an accounting package, a shop, a spreadsheet " +
          "— when they mention one in conversation. Nothing is replaced and nothing is imported by this; it only " +
          "records what they run, so what this workspace is missing can be explained honestly.",
        inputSchema: z.object({
          systemKey: z
            .string()
            .describe("yoco | sumup | loyverse | square | lightspeed | sage | xero | quickbooks | zoho-books | woocommerce | shopify | takealot | excel | word | simplepay | other"),
          label: z.string().optional().describe("What they call it — required when the key is 'other'."),
          recordsStillLiveThere: z.boolean().default(true),
          notes: z.string().optional(),
        }),
        execute: async ({ systemKey, label, recordsStillLiveThere, notes }) => {
          const row = await addSystem({
            tenantId: ctx.tenantId,
            systemKey,
            label: label ?? null,
            isSystemOfRecord: recordsStillLiveThere,
            notes: notes ?? null,
          });
          const def = SYSTEM_BY_KEY[systemKey];
          return {
            ok: true,
            name: row.label ?? def?.label ?? systemKey,
            howToBringItOver: def?.exportPath ?? null,
            brings: def?.brings ?? null,
          };
        },
      }),
  },

  writeAgreement: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          "Draft a proposal or contract for a customer. Say what it is for in a sentence and it is written; name a " +
          "template instead and the standard wording is used. It is created as a draft that nobody has seen — sending " +
          "it for signature is a separate step. The value and the dates come from here, never from the writing.",
        inputSchema: z.object({
          partyId: z.string().describe("The customer it is with."),
          instruction: z
            .string()
            .optional()
            .describe("What the agreement is for, in a sentence or two. Leave it out to use the template as written."),
          templateKey: z
            .string()
            .optional()
            .describe("proposal | service | retainer | supply | nda | subcontract. Used when there is no instruction, or nothing to draft with."),
          valueCents: z.number().int().optional(),
          recurrence: z.enum(["once", "monthly", "quarterly", "annually"]).optional(),
          startsAt: z.string().optional().describe("YYYY-MM-DD"),
          endsAt: z.string().optional().describe("YYYY-MM-DD"),
          validUntil: z.string().optional().describe("YYYY-MM-DD — when a proposal goes stale."),
        }),
        execute: async ({ partyId, instruction, templateKey, valueCents, recurrence, startsAt, endsAt, validUntil }) => {
          const [party, tenant] = await Promise.all([
            prisma.party.findFirst({ where: { id: partyId, tenantId: ctx.tenantId } }),
            prisma.tenant.findUniqueOrThrow({
              where: { id: ctx.tenantId },
              select: { name: true, currency: true, niche: true, countryCode: true },
            }),
          ]);
          if (!party) throw new Error("That customer is not in this workspace.");

          const when = (s?: string) => (s ? new Date(s) : null);
          const draft = instruction
            ? await draftAgreement({
                instruction,
                business: tenant.name,
                customer: party.companyName ?? party.name,
                value: valueCents === undefined ? undefined : formatMoney(valueCents, tenant.currency, { decimals: true }),
                starts: startsAt,
                ends: endsAt,
                niche: tenant.niche,
                country: tenant.countryCode ?? undefined,
              })
            : null;

          const agreement = await createAgreement({
            tenantId: ctx.tenantId,
            partyId,
            templateKey: draft ? null : templateKey ?? "service",
            kind: draft ? kindFromDraft(draft.kind) : undefined,
            title: draft?.title,
            clauses: draft ? withDisclaimer(draft.clauses) : undefined,
            valueCents: valueCents ?? null,
            recurrence: recurrence ?? null,
            startsAt: when(startsAt),
            endsAt: when(endsAt),
            validUntil: when(validUntil),
            createdById: ctx.membershipId ?? null,
          });

          return {
            id: agreement.id,
            number: agreement.number,
            title: agreement.title,
            drafted: Boolean(draft),
            status: agreement.status,
            note: draft ? "Written from what you said." : "Written from the standard template.",
          };
        },
      }),
  },

  sendAgreementForSignature: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Send a proposal or contract to the customer to sign. From here they can open it on their portal link and " +
          "sign it, so read it back to whoever asked before sending.",
        inputSchema: z.object({ agreementId: z.string() }),
        execute: async ({ agreementId }) => {
          const sent = await sendAgreement(ctx.tenantId, agreementId);
          return { ok: true, number: sent.number, status: sent.status };
        },
      }),
  },

  closeCustomerPortalMessage: {
    build: (ctx) =>
      tool({
        description:
          "Mark something a customer sent from their portal as dealt with, so it stops showing as waiting. " +
          "Use it once the payment has been recorded or the question has actually been answered.",
        inputSchema: z.object({ submissionId: z.string() }),
        execute: async ({ submissionId }) => {
          await markSubmissionHandled(ctx.tenantId, submissionId, ctx.membershipId ?? null);
          return { ok: true };
        },
      }),
  },

  applyCustomerDetailsCorrection: {
    capability: "product:manage",
    build: (ctx) =>
      tool({
        description:
          "Apply a correction a customer made to their own details from the portal — name, business name, " +
          "email, phone, address, VAT number. Changes what appears on their future documents, so read it back " +
          "to whoever asked before doing it.",
        inputSchema: z.object({ submissionId: z.string() }),
        execute: async ({ submissionId }) => acceptDetails(ctx.tenantId, submissionId, ctx.membershipId ?? null),
      }),
  },

  setRecurringInvoiceActive: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Pause or resume a recurring invoice template.",
        inputSchema: z.object({ templateId: z.string(), isActive: z.boolean() }),
        execute: async ({ templateId, isActive }) => {
          const owned = await prisma.recurringInvoice.findFirst({
            where: { id: templateId, tenantId: ctx.tenantId },
            select: { id: true },
          });
          if (!owned) throw new Error("Recurring invoice not found.");
          await setRecurringInvoiceActive(templateId, isActive);
          return { ok: true };
        },
      }),
  },
};
