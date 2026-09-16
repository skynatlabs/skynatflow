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
