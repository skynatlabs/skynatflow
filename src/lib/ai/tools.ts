// AI orchestration — Phase 3, but scaffolded now so the shape is right from
// the start. The AI does not get a separate code path: every tool here
// calls the exact same Business Graph API functions the owner UI calls
// (lib/core/money.ts, lib/core/parties.ts). This is what makes "AI as
// operator, not bolted on" (strategic report, Section 6) literally true.

import { tool } from "ai";
import { z } from "zod";
import { createQuote, recordPayment, findStaleTransactions } from "@/lib/core/money";
import { customerHistory } from "@/lib/core/parties";

export const businessGraphTools = {
  createQuote: tool({
    description: "Create a new quote for a customer with one or more line items.",
    inputSchema: z.object({
      tenantId: z.string(),
      partyId: z.string(),
      lines: z.array(
        z.object({
          itemId: z.string(),
          quantity: z.number().int().positive(),
          unitPriceCents: z.number().int().positive(),
        })
      ),
    }),
    execute: async (input) => createQuote(input),
  }),

  recordPayment: tool({
    description: "Record a payment (full or partial) against an existing invoice.",
    inputSchema: z.object({
      invoiceId: z.string(),
      amountCents: z.number().int().positive(),
    }),
    execute: async (input) => recordPayment(input),
  }),

  findStaleTransactions: tool({
    description:
      "Find quotes/invoices with no customer response past a threshold — the leakage-detection query behind the follow-up engine.",
    inputSchema: z.object({
      tenantId: z.string(),
      staleAfterDays: z.number().int().positive().optional(),
    }),
    execute: async (input) => findStaleTransactions(input),
  }),

  customerHistory: tool({
    description:
      "Get the full history for one customer: every quote, invoice, payment, delivery, and visit.",
    inputSchema: z.object({
      tenantId: z.string(),
      partyId: z.string(),
    }),
    execute: async (input) => customerHistory(input.tenantId, input.partyId),
  }),
};
