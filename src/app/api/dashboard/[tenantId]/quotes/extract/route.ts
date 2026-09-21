// "Paste everything in one box, we sort it into fields" — the entry point
// for a new quote. Free text like "Quote for John Smith, 2x solar panel at
// R5000 each" becomes structured fields the form prefills.
//
// Two readers, deliberately in this order:
//
//   1. The deterministic parser (src/lib/core/quoteComposer). It handles the
//      shape people overwhelmingly paste — one priced item per line — and it
//      reads money exactly: "R20 000" is twenty thousand, every time. It also
//      works when the AI provider is down or out of credit, which the model
//      path does not, and until now that meant this whole feature simply
//      stopped working with a message telling the owner to type it in by hand.
//   2. The model, for genuine prose ("quote John for two panels and a day of
//      labour, give him ten percent off") — shapes with no line structure to
//      read, plus the discount/tax/PO fields the parser doesn't cover.

import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getAiModel } from "@/lib/ai/model";
import { listProducts } from "@/lib/core/catalog";
import { parseQuoteText } from "@/lib/core/quoteComposer";

const ExtractSchema = z.object({
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  subject: z.string().nullable(),
  poNumber: z.string().nullable(),
  documentDiscountPercent: z.number().nullable(),
  lineItems: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().positive(),
      unitPriceCents: z.number().int().nullable(),
      discountPercent: z.number().nullable(),
      taxRatePercent: z.number().nullable(),
    })
  ),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await requireTenantAccess(tenantId);

  const { text } = await req.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Try the deterministic reader first. A hit here is more trustworthy than
  // a model's — it never invents a price — so it wins even when a model is
  // available.
  const parsed = parseQuoteText(text);
  if (parsed.lines.length > 0) {
    return NextResponse.json({
      extraction: {
        customerName: parsed.customer.companyName ?? parsed.customer.name ?? null,
        customerPhone: parsed.customer.phone ?? null,
        customerEmail: parsed.customer.email ?? null,
        subject: null,
        poNumber: null,
        documentDiscountPercent: null,
        lineItems: parsed.lines.map((line) => ({
          name: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountPercent: null,
          taxRatePercent: null,
        })),
      },
      readBy: "parser",
      warnings: parsed.warnings,
    });
  }

  const model = await getAiModel("fast");
  if (!model) {
    return NextResponse.json(
      {
        error:
          "I couldn't read any priced items in that. Try one per line, like: 2 x iPhone 16 @ 20000",
      },
      { status: 200 }
    );
  }

  const products = await listProducts(tenantId);
  const catalogHint = products.length
    ? `Their existing catalog (match by name if the text refers to one of these, using its real price unless the text overrides it): ${products
        .slice(0, 30)
        .map((p) => `${p.name} (${(p.unitPriceCents / 100).toFixed(2)})`)
        .join(", ")}`
    : "";

  try {
    const { object } = await generateObject({
      model,
      schema: ExtractSchema,
      prompt:
        `Extract structured quote details from this free-text description a business owner typed. ` +
        `Pull out: the customer's name and phone if mentioned, a short subject line if there's an ` +
        `obvious one, a PO/reference number if mentioned, an overall discount percent if one applies ` +
        `to the whole quote, and every line item with quantity, unit price in cents (null if genuinely ` +
        `not stated — never guess a number), a per-line discount percent, and a per-line tax percent ` +
        `if mentioned. ${catalogHint}\n\nText:\n${text}`,
    });
    return NextResponse.json({ extraction: object, readBy: "model" });
  } catch (err) {
    console.error("[quotes:extract] failed:", err);
    return NextResponse.json({ error: "Couldn't parse that — fill in the form manually below." }, { status: 200 });
  }
}
