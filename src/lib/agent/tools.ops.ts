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
