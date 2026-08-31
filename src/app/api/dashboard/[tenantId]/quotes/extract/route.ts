// "Paste everything in one box, we sort it into fields" — the Zoho-beating
// entry point for a new quote. Free text like "Quote for John Smith,
// 2x solar panel at R5000 each, 10% discount, due in 30 days" becomes
// structured fields the new-quote form can prefill. Same
// graceful-degradation posture as onboarding's prefill: no AI provider
// configured just means the button says so and the form stays manual.

import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getAiModel } from "@/lib/ai/model";
import { listProducts } from "@/lib/core/catalog";

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

  const model = await getAiModel();
  if (!model) {
    return NextResponse.json(
      { error: "No AI provider configured — fill in the form manually below." },
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
    return NextResponse.json({ extraction: object });
  } catch (err) {
    console.error("[quotes:extract] failed:", err);
    return NextResponse.json({ error: "Couldn't parse that — fill in the form manually below." }, { status: 200 });
  }
}
