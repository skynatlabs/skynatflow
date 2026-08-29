// "Upload a PDF quote, we set most of it up" — the Zoho-style onboarding
// pattern: a business's own past quote already contains their business
// name (the letterhead), a real customer, and real line items/prices, so
// extracting all three from one PDF gets someone further into setup than
// the website-prefill path alone. Same graceful-degradation posture as
// prefill.ts: returns null if ANTHROPIC_API_KEY isn't configured or
// extraction fails, never blocks onboarding.

import { generateObject } from "ai";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { getAiModel } from "@/lib/ai/model";

const QuotePdfSchema = z.object({
  businessName: z.string().nullable(),
  suggestedNiche: z.enum(Object.keys(NICHE_CONFIGS) as [string, ...string[]]).nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
  customerPhone: z.string().nullable(),
  lineItems: z.array(
    z.object({
      name: z.string(),
      unitPriceCents: z.number().int().nullable(),
    })
  ),
});

export type QuotePdfExtraction = z.infer<typeof QuotePdfSchema>;

export async function extractQuotePdf(fileBuffer: Buffer): Promise<QuotePdfExtraction | null> {
  const model = await getAiModel();
  if (!model) return null;

  let text: string;
  try {
    const parser = new PDFParse({ data: fileBuffer });
    const result = await parser.getText();
    text = result.text.slice(0, 8000);
  } catch (err) {
    console.error("[onboarding:extractQuotePdf] PDF parse failed:", err);
    return null;
  }

  if (!text.trim()) return null;

  try {
    const { object } = await generateObject({
      model,
      schema: QuotePdfSchema,
      prompt:
        `Here is the raw text extracted from a PDF quote or invoice. It was issued BY the business ` +
        `signing up (their letterhead — logo/name area, usually near the top) TO one of their ` +
        `customers (in a "Bill to" / "To" section). Extract: the issuing business's name, which of ` +
        `these business categories it fits (${Object.keys(NICHE_CONFIGS).join(", ")}), the customer's ` +
        `name/email/phone if present, and every line item with its unit price in cents (null if a ` +
        `price genuinely isn't stated for that line — never guess a number).\n\n${text}`,
    });
    return object;
  } catch (err) {
    console.error("[onboarding:extractQuotePdf] extraction failed:", err);
    return null;
  }
}
