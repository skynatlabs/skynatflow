// Reading a slip.
//
// A photograph of a till receipt becomes supplier, amount, tax, date, slip
// number and line items — the fields a person would otherwise type, at the
// moment they are least inclined to. Everything read is kept apart from what
// the person confirms (Expense.receiptReading versus the columns), so a
// correction never loses what was seen and a wrong reading is visible as one.
//
// Degrades to null with no model configured, like every AI step in this app.
// The capture form still works; it just asks for the fields.

import { generateObject } from "ai";
import { z } from "zod";
import { getAiModel } from "./model";

const ReceiptLine = z.object({
  description: z.string(),
  quantity: z.number().nullable().describe("How many, when the slip says. Null when it does not."),
  unit: z.string().nullable().describe("The unit the quantity is in — L, kg, each — when the slip says."),
  unitCents: z.number().int().nullable().describe("Price per unit in cents, when shown."),
  totalCents: z.number().int().describe("Line total in cents."),
});

const Reading = z.object({
  supplierName: z.string().nullable().describe("The business that issued the slip, as printed."),
  amountCents: z.number().int().nullable().describe("The total actually paid, in cents, including tax."),
  taxCents: z.number().int().nullable().describe("The tax (VAT/GST) amount shown, in cents. Null if not shown."),
  spentOn: z
    .string()
    .nullable()
    .describe("The date on the slip as YYYY-MM-DD. Null if unreadable. Never guess a date that is not printed."),
  reference: z.string().nullable().describe("The receipt, invoice or transaction number printed on it."),
  currency: z.string().nullable().describe("ISO 4217 code of the currency, when the slip makes it clear."),
  odometerKm: z.number().int().nullable().describe("An odometer reading, only if handwritten or printed on the slip."),
  lines: z.array(ReceiptLine).describe("Line items, in the order printed. Empty if the slip has no itemisation."),
  confidence: z.number().int().min(0).max(100).describe("How legible and unambiguous the slip was, 0-100."),
  notes: z.string().nullable().describe("Anything a person should double-check: a smudged total, a date that could be either way round."),
});

export type ReceiptReading = z.infer<typeof Reading>;

/**
 * Read a receipt image (a data URL) into structured fields, or null when no
 * model is configured or the image is not a receipt.
 */
export async function readReceipt(imageDataUrl: string): Promise<ReceiptReading | null> {
  const model = await getAiModel("fast");
  if (!model) return null;
  if (!imageDataUrl.startsWith("data:image/")) return null;

  try {
    const { object } = await generateObject({
      model,
      schema: Reading,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: imageDataUrl },
            {
              type: "text",
              text:
                "Read this receipt or invoice. Return only what is printed on it — amounts in cents, " +
                "the date exactly as printed converted to YYYY-MM-DD, the supplier's name as printed. " +
                "If a field is not on the slip, return null for it rather than inferring it. " +
                "If the image is not a receipt or invoice at all, return every field null, no lines, and confidence 0.",
            },
          ],
        },
      ],
    });

    // A reading with nothing in it is not a reading.
    if (object.amountCents === null && object.supplierName === null && object.lines.length === 0) {
      return null;
    }
    return object;
  } catch (err) {
    console.error("[receipt] could not read slip:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The subset of a reading the capture form pre-fills, as form-friendly strings. */
export function readingToFields(r: ReceiptReading) {
  return {
    supplierName: r.supplierName ?? "",
    amountRand: r.amountCents !== null ? (r.amountCents / 100).toFixed(2) : "",
    taxRand: r.taxCents !== null ? (r.taxCents / 100).toFixed(2) : "",
    spentOn: r.spentOn ?? "",
    reference: r.reference ?? "",
    odometerKm: r.odometerKm !== null ? String(r.odometerKm) : "",
    descriptionText:
      r.lines.length === 1
        ? r.lines[0].description
        : r.supplierName
          ? `${r.supplierName}${r.lines.length > 1 ? ` — ${r.lines.length} items` : ""}`
          : "",
  };
}
