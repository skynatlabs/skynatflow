// Reads one inbound email and extracts exactly what a business owner
// would otherwise have to notice themselves: is this a statement/
// invoice/legal notice that needs attention, and if it's a reply to a
// quote, did the customer give any real scheduling cue ("call me back in
// two weeks")? Same generateObject-with-a-schema pattern as
// src/lib/ai/proposal.ts — structured output, not free text to parse.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const ClassificationSchema = z.object({
  category: z.enum(["STATEMENT", "INVOICE", "LEGAL", "QUOTE_REPLY", "OTHER"]),
  isImportant: z.boolean().describe("True if this needs the owner's attention soon (statements, invoices, legal notices, or a customer giving a real answer)."),
  summary: z.string().describe("One plain-English sentence summarizing what this email is about."),
  scheduleFollowUpInDays: z
    .number()
    .nullable()
    .describe("If the sender gave a concrete timeframe for when to follow up (e.g. 'call me in 2 weeks'), the number of days from now. Null if no such cue."),
});

export type EmailClassification = z.infer<typeof ClassificationSchema>;

export async function classifyInboundEmail(params: {
  fromAddress: string;
  subject: string;
  bodyText: string;
}): Promise<EmailClassification> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Graceful degradation, same as everywhere else AI is optional —
    // falls back to a safe default (flagged important so nothing silently
    // gets buried just because the key isn't configured yet).
    return {
      category: "OTHER",
      isImportant: true,
      summary: `Email from ${params.fromAddress}: ${params.subject}`,
      scheduleFollowUpInDays: null,
    };
  }

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-5"),
    schema: ClassificationSchema,
    system:
      "You classify inbound business emails for a small business owner. " +
      "STATEMENT = a bank/supplier account statement. INVOICE = a bill the business needs to pay. " +
      "LEGAL = anything from a lawyer, regulator, or government body, or a legal notice/demand. " +
      "QUOTE_REPLY = a customer replying about a quote/proposal they were sent. " +
      "OTHER = anything else. Be conservative about isImportant — false positives are fine, missed important mail is not.",
    prompt: `From: ${params.fromAddress}\nSubject: ${params.subject}\n\nBody:\n${params.bodyText.slice(0, 4000)}`,
  });

  return object;
}
