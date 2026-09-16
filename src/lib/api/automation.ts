// The thousand-integration answer.
//
// Building connectors one at a time is how a small team spends two years
// shipping integrations nobody asked for in the order nobody wanted. Zapier,
// Make and n8n each reach thousands of applications already; what they need
// from this side is small and specific, and building it once ends the queue.
//
// Three things, and none of them is a per-app connector:
//
//   A CATALOGUE. What can start an automation and what an automation can do,
//   described in a shape those platforms read directly. Written here rather
//   than in three vendor dashboards, so the three can never drift apart.
//
//   A POLLING TRIGGER. Zapier and Make prefer to poll, and their polling has
//   one hard rule most APIs get wrong: newest first, stable ids, and nothing
//   that shifts position between calls, or the platform replays or skips.
//
//   WEBHOOKS THAT ALREADY EXIST. The push path is the webhook endpoint this
//   app already signs and retries. An automation platform is just another
//   subscriber.

import { prisma } from "@/lib/db";

export interface TriggerDef {
  key: string;
  label: string;
  /** What it means, in the words of somebody building an automation. */
  description: string;
  /** The webhook event it corresponds to, where there is one. */
  event?: string;
  /** Fields in each item, so a platform can map them without a sample. */
  fields: Array<{ name: string; type: "string" | "number" | "datetime" | "boolean"; label: string }>;
}

export interface ActionDef {
  key: string;
  label: string;
  description: string;
  /** The API operation it calls. */
  operation: string;
  inputs: Array<{ name: string; type: "string" | "number"; required: boolean; label: string }>;
}

const MONEY = { name: "amountCents", type: "number" as const, label: "Amount in cents" };
const WHEN = { name: "createdAt", type: "datetime" as const, label: "When it happened" };
const WHO = { name: "customerName", type: "string" as const, label: "Customer" };

export const TRIGGERS: TriggerDef[] = [
  {
    key: "new_quote",
    label: "New quote",
    description: "Fires when a quote is created. The most common start of an automation: put it in a spreadsheet, tell a channel, make a task.",
    event: "quote.created",
    fields: [{ name: "id", type: "string", label: "Quote id" }, WHO, MONEY, WHEN, { name: "status", type: "string", label: "Status" }],
  },
  {
    key: "quote_accepted",
    label: "Quote accepted",
    description: "Fires the moment a customer signs a quote on their portal link.",
    event: "quote.accepted",
    fields: [{ name: "id", type: "string", label: "Quote id" }, WHO, MONEY, WHEN],
  },
  {
    key: "invoice_paid",
    label: "Invoice paid",
    description: "Fires when an invoice is settled in full. The trigger most businesses actually want.",
    event: "invoice.paid",
    fields: [{ name: "id", type: "string", label: "Invoice id" }, WHO, MONEY, WHEN],
  },
  {
    key: "new_customer",
    label: "New customer",
    description: "Fires when a customer is added, however they were added — typed in, imported, or through an enquiry form.",
    fields: [
      { name: "id", type: "string", label: "Customer id" },
      { name: "name", type: "string", label: "Name" },
      { name: "email", type: "string", label: "Email" },
      { name: "phone", type: "string", label: "Phone" },
      WHEN,
    ],
  },
  {
    key: "new_enquiry",
    label: "New enquiry",
    description: "Fires when somebody fills in one of this workspace's forms.",
    fields: [
      { name: "id", type: "string", label: "Enquiry id" },
      { name: "form", type: "string", label: "Which form" },
      { name: "name", type: "string", label: "Their name" },
      { name: "need", type: "string", label: "What they need" },
      WHEN,
    ],
  },
  {
    key: "job_completed",
    label: "Job completed",
    description: "Fires when a job card is marked done.",
    fields: [
      { name: "id", type: "string", label: "Job id" },
      { name: "title", type: "string", label: "Job" },
      WHO,
      { name: "completedAt", type: "datetime", label: "Finished" },
    ],
  },
  {
    key: "overdue_invoice",
    label: "Invoice went overdue",
    description: "Fires when an invoice passes its due date unpaid.",
    fields: [
      { name: "id", type: "string", label: "Invoice id" },
      WHO,
      MONEY,
      { name: "dueAt", type: "datetime", label: "Was due" },
      { name: "daysLate", type: "number", label: "Days late" },
    ],
  },
];

export const ACTIONS: ActionDef[] = [
  {
    key: "create_customer",
    label: "Add a customer",
    description: "Creates a customer, or updates the one already on file with that number or address.",
    operation: "POST /v1/customers",
    inputs: [
      { name: "name", type: "string", required: true, label: "Name" },
      { name: "phone", type: "string", required: false, label: "Phone" },
      { name: "email", type: "string", required: false, label: "Email" },
    ],
  },
  {
    key: "create_quote",
    label: "Draft a quote",
    description: "Creates a quote as a draft. Nothing is sent to anybody by this.",
    operation: "POST /v1/quotes",
    inputs: [
      { name: "customerId", type: "string", required: true, label: "Customer" },
      { name: "itemId", type: "string", required: true, label: "Product or service" },
      { name: "quantity", type: "number", required: true, label: "How many" },
      { name: "unitPriceCents", type: "number", required: false, label: "Price each, in cents" },
    ],
  },
  {
    key: "create_task",
    label: "Make a task",
    description: "Puts a task on the board.",
    operation: "POST /v1/tasks",
    inputs: [
      { name: "title", type: "string", required: true, label: "What needs doing" },
      { name: "dueAt", type: "string", required: false, label: "When by" },
    ],
  },
  {
    key: "record_payment",
    label: "Record a payment",
    description: "Records money received against an invoice. This moves money in the books, so the key needs the permission for it.",
    operation: "POST /v1/invoices/{id}/payments",
    inputs: [
      { name: "invoiceId", type: "string", required: true, label: "Invoice" },
      { name: "amountCents", type: "number", required: true, label: "Amount in cents" },
    ],
  },
];

/** The catalogue, in the shape an automation platform reads. */
export function catalogue() {
  return {
    triggers: TRIGGERS.map((t) => ({ key: t.key, label: t.label, description: t.description, fields: t.fields, polling: `/api/v1/triggers/${t.key}` })),
    actions: ACTIONS,
    auth: {
      type: "api_key",
      header: "Authorization",
      format: "Bearer <key>",
      test: "/api/v1/me",
      note: "A key carries a role. What it may do is exactly what that role may do in the app — an automation can never exceed the person who made the key.",
    },
    webhooks: {
      note: "Every trigger with an event can also be pushed rather than polled. Webhooks are signed and retried; see Settings → Developer.",
      events: TRIGGERS.filter((t) => t.event).map((t) => t.event),
    },
  };
}

export interface PollItem {
  id: string;
  [key: string]: unknown;
}

/**
 * The polling endpoint's data.
 *
 * Newest first, stable ids, `since` exclusive. Those three are not style
 * choices: Zapier and Make de-duplicate on the id and stop at the first one
 * they have seen, so a list that reorders itself between calls makes them
 * replay old items or skip new ones — and a business finds out because a
 * customer got the same message four times.
 */
export async function poll(params: { tenantId: string; trigger: string; since?: Date; limit?: number }): Promise<PollItem[]> {
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const after = params.since;
  const order = { createdAt: "desc" as const };

  switch (params.trigger) {
    case "new_quote":
    case "quote_accepted": {
      const rows = await prisma.transaction.findMany({
        where: {
          tenantId: params.tenantId,
          type: "QUOTE",
          ...(params.trigger === "quote_accepted" ? { status: "ACCEPTED" } : { status: { not: "DRAFT" } }),
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: order,
        take: limit,
        select: { id: true, amountCents: true, status: true, createdAt: true, externalRef: true, party: { select: { name: true, companyName: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.externalRef,
        customerName: r.party.companyName ?? r.party.name,
        amountCents: r.amountCents,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    case "invoice_paid": {
      const rows = await prisma.transaction.findMany({
        where: { tenantId: params.tenantId, type: "INVOICE", status: "PAID", ...(after ? { createdAt: { gt: after } } : {}) },
        orderBy: order,
        take: limit,
        select: { id: true, amountCents: true, createdAt: true, externalRef: true, party: { select: { name: true, companyName: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.externalRef,
        customerName: r.party.companyName ?? r.party.name,
        amountCents: r.amountCents,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    case "overdue_invoice": {
      const now = new Date();
      const rows = await prisma.transaction.findMany({
        where: {
          tenantId: params.tenantId,
          type: "INVOICE",
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
          dueAt: { not: null, lt: now },
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: order,
        take: limit,
        select: { id: true, amountCents: true, dueAt: true, createdAt: true, party: { select: { name: true, companyName: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        customerName: r.party.companyName ?? r.party.name,
        amountCents: r.amountCents,
        dueAt: r.dueAt?.toISOString() ?? null,
        daysLate: r.dueAt ? Math.floor((now.getTime() - r.dueAt.getTime()) / 86_400_000) : 0,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    case "new_customer": {
      const rows = await prisma.party.findMany({
        where: { tenantId: params.tenantId, role: { in: ["CUSTOMER", "PATIENT"] }, ...(after ? { createdAt: { gt: after } } : {}) },
        orderBy: order,
        take: limit,
        select: { id: true, name: true, companyName: true, email: true, phone: true, createdAt: true },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.companyName ?? r.name,
        email: r.email,
        phone: r.phone,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    case "new_enquiry": {
      const rows = await prisma.leadSubmission.findMany({
        where: { tenantId: params.tenantId, ...(after ? { createdAt: { gt: after } } : {}) },
        orderBy: order,
        take: limit,
        include: { form: { select: { title: true } } },
      });
      return rows.map((r) => {
        const answers = r.answers as Record<string, string>;
        return {
          id: r.id,
          form: r.form.title,
          name: answers.name ?? null,
          phone: answers.phone ?? null,
          email: answers.email ?? null,
          need: answers.need ?? null,
          createdAt: r.createdAt.toISOString(),
        };
      });
    }
    case "job_completed": {
      const rows = await prisma.jobCard.findMany({
        where: { tenantId: params.tenantId, status: "DONE", ...(after ? { completedAt: { gt: after } } : {}) },
        orderBy: { completedAt: "desc" },
        take: limit,
        select: { id: true, title: true, completedAt: true, createdAt: true, party: { select: { name: true, companyName: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        customerName: r.party.companyName ?? r.party.name,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    }
    default:
      throw new Error("There is no such trigger.");
  }
}

/**
 * A sample item, so a platform can build its field mapping before the
 * business has any real data.
 *
 * Every automation platform asks for this, and the ones that get it wrong ask
 * the customer to "run the trigger once" — which on a new workspace means
 * inventing a fake invoice to get past a setup screen.
 */
export function sampleFor(trigger: string): PollItem {
  const base = { id: "sample", createdAt: new Date().toISOString() };
  switch (trigger) {
    case "new_quote":
    case "quote_accepted":
      return { ...base, number: "QT-0042", customerName: "Ndlovu Trading CC", amountCents: 1_240_000, status: "SENT" };
    case "invoice_paid":
      return { ...base, number: "INV-2041", customerName: "Ndlovu Trading CC", amountCents: 1_845_000 };
    case "overdue_invoice":
      return { ...base, customerName: "Ndlovu Trading CC", amountCents: 1_845_000, dueAt: new Date().toISOString(), daysLate: 21 };
    case "new_customer":
      return { ...base, name: "Ndlovu Trading CC", email: "jabu@ndlovutrading.co.za", phone: "+27821234567" };
    case "new_enquiry":
      return { ...base, form: "Get a quote", name: "Jabu Ndlovu", phone: "+27821234567", email: null, need: "Burst geyser, urgent" };
    case "job_completed":
      return { ...base, title: "Replace 150L geyser", customerName: "Ndlovu Trading CC", completedAt: new Date().toISOString() };
    default:
      throw new Error("There is no such trigger.");
  }
}
