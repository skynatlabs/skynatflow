// The agent's hands.
//
// Two rules govern everything in this file, and both are load-bearing:
//
//  1. TENANT IS BOUND, NEVER ASKED FOR. No tool schema contains a tenantId.
//     The runtime closes over the tenant it was constructed for and passes
//     it to the core function itself. A model cannot be prompt-injected
//     into naming another tenant, because there is nowhere to put one.
//
//  2. NO PRIVATE CODE PATH. Every tool calls the same src/lib/core/*
//     function the dashboard calls, so the tenant scoping and the
//     capability checks added there apply identically to the agent. The
//     agent is another caller, not a back door.
//
// Write tools additionally declare the capability they need, checked against
// the acting user's role before the tool is even offered to the model — a
// REP never sees a tool they could not legally run.

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { can, type Capability, type Role } from "@/lib/core/access";
import { EXTRA_READ_TOOLS, EXTRA_WRITE_TOOLS } from "@/lib/agent/tools.extra";
import { OPS_READ_TOOLS, OPS_WRITE_TOOLS } from "@/lib/agent/tools.ops";

import {
  createQuote,
  recordPayment,
  recordRefund,
  sendQuote,
  convertToInvoice,
  findStaleTransactions,
  customerBalance,
} from "@/lib/core/money";
import {
  createParty,
  customerHistory,
  listCustomersPaginated,
  applyPartyDetailChange,
} from "@/lib/core/parties";
import { createTask, listTasks, updateTaskStatus } from "@/lib/core/tasks";
import { scheduleAppointment } from "@/lib/core/movement";
import { prisma } from "@/lib/db";

export interface AgentContext {
  tenantId: string;
  role: Role;
  userId: string;
  membershipId?: string | null;
  // Vocabulary for this tenant's vertical, so the agent talks about
  // "patients" or "clients" rather than always "customers".
  customerLabel: string;
}

// `tool()` infers a distinct generic per input schema, so the registry can't
// name one shared return type without collapsing them all to `never`. The
// builders stay inferred; ToolSet is the SDK's own "bag of tools" type and is
// applied only where the bag is handed to the model.
type ToolDef = {
  capability?: Capability;
  build: (ctx: AgentContext) => ToolSet[string];
};

// ---------------------------------------------------------------- read tools

const READ_TOOLS: Record<string, ToolDef> = {
  findCustomers: {
    build: (ctx) =>
      tool({
        description:
          "Search this workspace's customers by name, email or phone. Use this to resolve a " +
          "name mentioned by the user into a real customer id before acting on them.",
        inputSchema: z.object({
          query: z.string().describe("Partial name, email or phone. Empty string lists everyone."),
        }),
        execute: async ({ query }) => {
          const { items, total } = await listCustomersPaginated(ctx.tenantId, 1, undefined, query);
          return {
            total,
            customers: items.map((c) => ({
              id: c.id,
              name: c.name,
              company: c.companyName,
              phone: c.phone,
              email: c.email,
            })),
          };
        },
      }),
  },

  customerHistory: {
    build: (ctx) =>
      tool({
        description:
          "Everything on one customer: their quotes, invoices, payments, deliveries and visits. " +
          "Use before answering any question about what happened with a customer.",
        inputSchema: z.object({ customerId: z.string() }),
        execute: async ({ customerId }) => customerHistory(ctx.tenantId, customerId),
      }),
  },

  customerBalance: {
    build: (ctx) =>
      tool({
        description: "What one customer currently owes, in cents.",
        inputSchema: z.object({ customerId: z.string() }),
        execute: async ({ customerId }) => ({
          balanceCents: await customerBalance(ctx.tenantId, customerId),
        }),
      }),
  },

  findStaleDocuments: {
    build: (ctx) =>
      tool({
        description:
          "Quotes and invoices with no customer response past a threshold — the money leaking " +
          "out of the business. Use for 'who hasn't paid', 'what's gone quiet', 'what needs chasing'.",
        inputSchema: z.object({
          staleAfterDays: z.number().int().positive().optional().default(7),
        }),
        execute: async ({ staleAfterDays }) =>
          findStaleTransactions({ tenantId: ctx.tenantId, staleAfterDays }),
      }),
  },

  listProducts: {
    build: (ctx) =>
      tool({
        description:
          "This workspace's catalog. Use to resolve a product the user named into an item id " +
          "and its current price before putting it on a quote.",
        inputSchema: z.object({ query: z.string().optional() }),
        execute: async ({ query }) => {
          const items = await prisma.item.findMany({
            where: {
              tenantId: ctx.tenantId,
              isActive: true,
              ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
            },
            select: { id: true, name: true, sku: true, unitPriceCents: true, stockQty: true },
            take: 40,
          });
          return { items };
        },
      }),
  },

  listTasks: {
    build: (ctx) =>
      tool({
        description: "The team's task board for this workspace.",
        inputSchema: z.object({}),
        execute: async () => ({ tasks: await listTasks(ctx.tenantId) }),
      }),
  },

  businessSnapshot: {
    build: (ctx) =>
      tool({
        description:
          "Headline numbers for the whole workspace right now: outstanding receivables, open " +
          "quotes, overdue invoices and customer count. Use to answer 'how are we doing'.",
        inputSchema: z.object({}),
        execute: async () => {
          const [openQuotes, overdue, customers, unpaid] = await Promise.all([
            prisma.transaction.count({
              where: { tenantId: ctx.tenantId, type: "QUOTE", status: { in: ["SENT", "DRAFT"] } },
            }),
            prisma.transaction.count({
              where: { tenantId: ctx.tenantId, type: "INVOICE", status: "OVERDUE" },
            }),
            prisma.party.count({
              where: { tenantId: ctx.tenantId, role: { in: ["CUSTOMER", "PATIENT"] } },
            }),
            prisma.transaction.aggregate({
              where: {
                tenantId: ctx.tenantId,
                type: "INVOICE",
                status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
              },
              _sum: { amountCents: true },
            }),
          ]);
          return {
            openQuotes,
            overdueInvoices: overdue,
            customerCount: customers,
            outstandingCents: unpaid._sum.amountCents ?? 0,
          };
        },
      }),
  },
};

// --------------------------------------------------------------- write tools

const WRITE_TOOLS: Record<string, ToolDef> = {
  createCustomer: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          `Add a new ${ctx.customerLabel.toLowerCase()} to this workspace. Check findCustomers ` +
          `first — do not create a duplicate of someone who already exists.`,
        inputSchema: z.object({
          name: z.string(),
          phone: z.string().optional(),
          email: z.string().optional(),
          companyName: z.string().optional(),
        }),
        execute: async (input) => {
          const party = await createParty({ tenantId: ctx.tenantId, role: "CUSTOMER", ...input });
          return { id: party.id, name: party.name };
        },
      }),
  },

  updateCustomerDetails: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          "Change details on an existing customer. Only the fields you pass are touched; " +
          "everything else is left exactly as it was.",
        inputSchema: z.object({
          customerId: z.string(),
          name: z.string().optional(),
          companyName: z.string().optional(),
          vatNumber: z.string().optional(),
          addressLine: z.string().optional(),
          city: z.string().optional(),
          postalCode: z.string().optional(),
          country: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
        }),
        execute: async ({ customerId, ...changes }) => {
          await applyPartyDetailChange(ctx.tenantId, customerId, changes);
          return { ok: true, changed: Object.keys(changes) };
        },
      }),
  },

  createQuote: {
    capability: "quote:create",
    build: (ctx) =>
      tool({
        description:
          "Create a DRAFT quote for a customer. Never sends it — a person reviews and sends. " +
          "Resolve the customer and each product with findCustomers/listProducts first.",
        inputSchema: z.object({
          customerId: z.string(),
          lines: z
            .array(
              z.object({
                itemId: z.string(),
                quantity: z.number().int().positive(),
                unitPriceCents: z.number().int().positive(),
              })
            )
            .min(1),
          subject: z.string().optional(),
        }),
        execute: async ({ customerId, lines, subject }) => {
          const quote = await createQuote({
            tenantId: ctx.tenantId,
            partyId: customerId,
            lines,
            subject,
            salesPersonMembershipId: ctx.membershipId ?? undefined,
          });
          return { quoteId: quote.id, amountCents: quote.amountCents, status: quote.status };
        },
      }),
  },

  sendQuote: {
    capability: "quote:send",
    build: (ctx) =>
      tool({
        description:
          "Mark a quote as sent to the customer. This is customer-facing — only do it when the " +
          "user has clearly asked for the quote to go out.",
        inputSchema: z.object({ quoteId: z.string() }),
        execute: async ({ quoteId }) => {
          await sendQuote(quoteId, ctx.tenantId);
          return { ok: true };
        },
      }),
  },

  convertQuoteToInvoice: {
    capability: "invoice:create",
    build: (ctx) =>
      tool({
        description: "Turn an accepted quote into an invoice.",
        inputSchema: z.object({
          quoteId: z.string(),
          dueInDays: z.number().int().positive().optional(),
        }),
        execute: async ({ quoteId, dueInDays }) => {
          const quote = await prisma.transaction.findUnique({ where: { id: quoteId } });
          if (!quote || quote.tenantId !== ctx.tenantId) throw new Error("Quote not found.");
          const invoice = await convertToInvoice({ quoteId, dueInDays });
          return { invoiceId: invoice.id, amountCents: invoice.amountCents };
        },
      }),
  },

  recordPayment: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Record a payment received against an invoice.",
        inputSchema: z.object({
          invoiceId: z.string(),
          amountCents: z.number().int().positive(),
        }),
        execute: async ({ invoiceId, amountCents }) => {
          const invoice = await prisma.transaction.findUnique({ where: { id: invoiceId } });
          if (!invoice || invoice.tenantId !== ctx.tenantId) throw new Error("Invoice not found.");
          await recordPayment({ invoiceId, amountCents });
          return { ok: true };
        },
      }),
  },

  recordRefund: {
    capability: "payment:record",
    build: (ctx) =>
      tool({
        description: "Record a refund issued against an invoice.",
        inputSchema: z.object({
          invoiceId: z.string(),
          amountCents: z.number().int().positive(),
          reason: z.string().optional(),
        }),
        execute: async ({ invoiceId, amountCents, reason }) => {
          const invoice = await prisma.transaction.findUnique({ where: { id: invoiceId } });
          if (!invoice || invoice.tenantId !== ctx.tenantId) throw new Error("Invoice not found.");
          await recordRefund({ invoiceId, amountCents, reason });
          return { ok: true };
        },
      }),
  },

  createTask: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Put a task on the team board.",
        inputSchema: z.object({
          title: z.string(),
          dueAtIso: z.string().optional().describe("ISO 8601 datetime"),
        }),
        execute: async ({ title, dueAtIso }) => {
          const task = await createTask({
            tenantId: ctx.tenantId,
            title,
            dueAt: dueAtIso ? new Date(dueAtIso) : undefined,
          });
          return { taskId: task.id };
        },
      }),
  },

  updateTaskStatus: {
    capability: "task:manage",
    build: (ctx) =>
      tool({
        description: "Move a task to TODO, IN_PROGRESS or DONE.",
        inputSchema: z.object({
          taskId: z.string(),
          status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
        }),
        execute: async ({ taskId, status }) => {
          await updateTaskStatus(ctx.tenantId, taskId, status);
          return { ok: true };
        },
      }),
  },

  scheduleAppointment: {
    capability: "delivery:log",
    build: (ctx) =>
      tool({
        description:
          "Book a site visit or consultation with a customer. Resolve relative dates " +
          "('Tuesday morning') against the current date given in your instructions.",
        inputSchema: z.object({
          customerId: z.string(),
          scheduledAtIso: z.string().describe("ISO 8601 datetime"),
          type: z.enum(["SITE_VISIT", "CONSULTATION"]),
          notes: z.string().optional(),
        }),
        execute: async ({ customerId, scheduledAtIso, type, notes }) => {
          const event = await scheduleAppointment({
            tenantId: ctx.tenantId,
            partyId: customerId,
            scheduledAt: new Date(scheduledAtIso),
            type,
            notes,
          });
          return { eventId: event.id };
        },
      }),
  },
};

/**
 * The tool set this specific user, in this specific workspace, is allowed to
 * drive. Read tools are always present; a write tool appears only if the
 * caller's role actually holds its capability — so the model is never even
 * tempted by an action that would be refused downstream.
 */
export function buildAgentTools(ctx: AgentContext): ToolSet {
  const tools: ToolSet = {};

  // Read tools are unconditional; write tools are withheld from roles that
  // don't hold their capability, so the model is never offered an action that
  // would be refused downstream.
  for (const [name, def] of Object.entries({ ...READ_TOOLS, ...EXTRA_READ_TOOLS, ...OPS_READ_TOOLS })) {
    tools[name] = def.build(ctx);
  }
  for (const [name, def] of Object.entries({ ...WRITE_TOOLS, ...EXTRA_WRITE_TOOLS, ...OPS_WRITE_TOOLS })) {
    if (def.capability && !can(ctx.role, def.capability)) continue;
    tools[name] = def.build(ctx);
  }

  return tools;
}

/** Names only — used by tests and by the run log, without building closures. */
export function agentToolNames(role: Role): string[] {
  return [
    ...Object.keys({ ...READ_TOOLS, ...EXTRA_READ_TOOLS, ...OPS_READ_TOOLS }),
    ...Object.entries({ ...WRITE_TOOLS, ...EXTRA_WRITE_TOOLS, ...OPS_WRITE_TOOLS })
      .filter(([, d]) => !d.capability || can(role, d.capability))
      .map(([n]) => n),
  ];
}

/** Write tools that mutate customer-facing or money state, for the run log. */
export const MUTATING_TOOLS = new Set([
  ...Object.keys(WRITE_TOOLS),
  ...Object.keys(EXTRA_WRITE_TOOLS),
  ...Object.keys(OPS_WRITE_TOOLS),
]);
