// The PA command box — "send quote for R39,995 8kva system to John, 082
// 123 4567" becomes a real draft quote, ready to check and send. This is
// the next-gen-CRM move: instead of re-typing a quote you've sent a dozen
// times before, you describe the outcome and flow finds the closest past
// quote, clones its line items, attaches the new customer, and hands it
// back as a DRAFT for a human to approve — never auto-sent, since money
// documents always need a person's eyes first.

import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getAiModel } from "@/lib/ai/model";
import { prisma } from "@/lib/db";
import { createQuote } from "@/lib/core/money";
import { scheduleAppointment } from "@/lib/core/movement";
import { applyPartyDetailChange } from "@/lib/core/parties";

const CommandSchema = z.object({
  intent: z.enum(["send_quote", "schedule_visit", "update_customer_details", "unknown"]),
  targetAmountCents: z.number().int().positive().nullable(),
  keywords: z.array(z.string()),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  customerEmail: z.string().nullable(),
  // Only meaningful for schedule_visit — an ISO 8601 datetime the model
  // resolves from natural language ("Tuesday morning") against the
  // current date, which is handed in the prompt below.
  scheduledAtIso: z.string().nullable(),
  visitType: z.enum(["SITE_VISIT", "CONSULTATION"]).nullable(),
  // Only meaningful for update_customer_details — the NEW values being
  // requested, one per field that's actually mentioned. customerName
  // above identifies WHO; a non-null newName here means "rename them to
  // this" and is a different thing from the identifying name.
  newName: z.string().nullable(),
  newCompanyName: z.string().nullable(),
  newVatNumber: z.string().nullable(),
  newAddressLine: z.string().nullable(),
  newCity: z.string().nullable(),
  newPostalCode: z.string().nullable(),
  newCountry: z.string().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await requireTenantAccess(tenantId);

  const { text } = await req.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Tell me what you need — e.g. \"send quote for R39,995 8kva system to John, 082 123 4567\"" }, { status: 400 });
  }

  const model = await getAiModel();
  if (!model) {
    return NextResponse.json({ error: "No AI provider configured — ask your admin to set one up in Settings." }, { status: 200 });
  }

  const now = new Date();
  const { object: cmd } = await generateObject({
    model,
    schema: CommandSchema,
    prompt:
      `A business owner typed this instruction into their CRM's assistant box. Work out what they want. ` +
      `Today's date/time is ${now.toISOString()}. Three intents are supported: ` +
      `"send_quote" — reuse a past quote for a new customer; "schedule_visit" — book a future site ` +
      `visit or consultation for a customer (e.g. "book Peter in for a site visit Tuesday morning"); and ` +
      `"update_customer_details" — apply a customer-requested change to their own contact/billing details ` +
      `(e.g. "the customer on invoice for Acme Corp says their VAT number is now 123", or "update Jane's ` +
      `address to 12 Oak Street"). This is ONLY for changing the customer's own record (name/company/VAT/` +
      `address) — never for changing prices, quantities, or anything about what was billed. ` +
      `For send_quote: pull out the target price in cents if a rand/dollar amount is mentioned ` +
      `(e.g. "R39,995" -> 3999500), and a few keywords describing the product/system so the closest past ` +
      `quote can be found (e.g. "8kva", "solar", "system"). For schedule_visit: resolve any relative date/time ` +
      `("Tuesday morning", "next week") against today's date into scheduledAtIso (ISO 8601, in the future), ` +
      `and set visitType — CONSULTATION for a meeting/checkup-style visit, SITE_VISIT otherwise. ` +
      `For update_customer_details: customerName/customerPhone/customerEmail identify WHO to find (use ` +
      `whatever identifying detail is given); the new* fields hold the NEW value for each field actually ` +
      `mentioned — leave every field not mentioned as null, never guess or invent one. ` +
      `Always pull out the customer's identifying name/phone/email if given. ` +
      `If this isn't about any of those three actions, set intent to "unknown".\n\nInstruction:\n${text}`,
  });

  if (cmd.intent === "schedule_visit") {
    if (!cmd.customerName) {
      return NextResponse.json({ error: "Who is this visit for? Include a name in your instruction." }, { status: 200 });
    }
    if (!cmd.scheduledAtIso) {
      return NextResponse.json({ error: "When should this be booked for? Include a day/time in your instruction." }, { status: 200 });
    }

    let party = cmd.customerPhone
      ? await prisma.party.findFirst({ where: { tenantId, phone: cmd.customerPhone } })
      : null;
    if (!party) {
      party = await prisma.party.findFirst({ where: { tenantId, name: cmd.customerName } });
    }
    if (!party) {
      party = await prisma.party.create({
        data: { tenantId, role: "CUSTOMER", name: cmd.customerName, phone: cmd.customerPhone, email: cmd.customerEmail },
      });
    }

    try {
      const event = await scheduleAppointment({
        tenantId,
        partyId: party.id,
        type: cmd.visitType ?? "SITE_VISIT",
        scheduledAt: new Date(cmd.scheduledAtIso),
      });
      return NextResponse.json({
        appointmentId: event.id,
        customerName: party.name,
        scheduledAt: event.scheduledAt,
        reviewUrl: `/dashboard/${tenantId}/appointments`,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't book that." }, { status: 200 });
    }
  }

  if (cmd.intent === "update_customer_details") {
    if (!cmd.customerName && !cmd.customerPhone && !cmd.customerEmail) {
      return NextResponse.json({ error: "Which customer is this for? Include a name, phone, or email." }, { status: 200 });
    }

    let party = cmd.customerPhone
      ? await prisma.party.findFirst({ where: { tenantId, phone: cmd.customerPhone } })
      : null;
    if (!party && cmd.customerEmail) {
      party = await prisma.party.findFirst({ where: { tenantId, email: cmd.customerEmail } });
    }
    if (!party && cmd.customerName) {
      party = await prisma.party.findFirst({ where: { tenantId, name: cmd.customerName } });
    }
    if (!party) {
      return NextResponse.json({ error: "Couldn't find that customer on file — check the name/phone/email and try again." }, { status: 200 });
    }

    try {
      await applyPartyDetailChange(tenantId, party.id, {
        name: cmd.newName ?? undefined,
        companyName: cmd.newCompanyName ?? undefined,
        vatNumber: cmd.newVatNumber ?? undefined,
        addressLine: cmd.newAddressLine ?? undefined,
        city: cmd.newCity ?? undefined,
        postalCode: cmd.newPostalCode ?? undefined,
        country: cmd.newCountry ?? undefined,
      });
      return NextResponse.json({
        customerName: party.name,
        detailsUpdated: true,
        reviewUrl: `/dashboard/${tenantId}/customers/${party.id}`,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't update that." }, { status: 200 });
    }
  }

  if (cmd.intent !== "send_quote") {
    // Not an action this endpoint knows how to do — let the caller (the
    // floating PA button) fall back to treating it as a plain question
    // instead of surfacing this as a hard error.
    return NextResponse.json({ fallbackToQa: true }, { status: 200 });
  }
  if (!cmd.customerName) {
    return NextResponse.json({ error: "Who is this quote for? Include a name (and ideally phone/email) in your instruction." }, { status: 200 });
  }

  // Candidate pool: past quotes with their lines, most recent first, capped
  // for cost — good enough since a real business reuses a fairly small set
  // of "standard systems" over and over.
  const candidates = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE" },
    include: { itemLines: { include: { item: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  if (!candidates.length) {
    return NextResponse.json({ error: "No past quotes to copy from yet — create the first one manually." }, { status: 200 });
  }

  const keywordSet = cmd.keywords.map((k) => k.toLowerCase());
  let best: (typeof candidates)[number] | null = null;
  let bestScore = -Infinity;

  for (const q of candidates) {
    const haystack = [q.subject ?? "", q.systemInfo ?? "", ...q.itemLines.map((l) => l.item.name)]
      .join(" ")
      .toLowerCase();
    const keywordHits = keywordSet.filter((k) => haystack.includes(k)).length;

    let priceScore = 0;
    if (cmd.targetAmountCents) {
      const diff = Math.abs(q.amountCents - cmd.targetAmountCents);
      const pct = diff / cmd.targetAmountCents;
      priceScore = pct < 0.02 ? 5 : pct < 0.1 ? 2 : pct < 0.25 ? 0.5 : -1;
    }

    const score = keywordHits * 3 + priceScore;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }

  if (!best || bestScore <= 0) {
    return NextResponse.json({ error: "Couldn't find a close-enough past quote to copy — create this one manually so flow can reuse it next time." }, { status: 200 });
  }

  // Find-or-create the customer by phone/email, else create a fresh Party.
  let party = null;
  if (cmd.customerPhone) {
    party = await prisma.party.findFirst({ where: { tenantId, phone: cmd.customerPhone } });
  }
  if (!party && cmd.customerEmail) {
    party = await prisma.party.findFirst({ where: { tenantId, email: cmd.customerEmail } });
  }
  if (!party) {
    party = await prisma.party.create({
      data: {
        tenantId,
        role: "CUSTOMER",
        name: cmd.customerName,
        phone: cmd.customerPhone,
        email: cmd.customerEmail,
      },
    });
  }

  const quote = await createQuote({
    tenantId,
    partyId: party.id,
    lines: best.itemLines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent ?? undefined,
      taxRatePercent: l.taxRatePercent ?? undefined,
    })),
    discountPercent: best.discountPercent ?? 0,
    subject: best.subject ?? undefined,
    quoteKind: best.quoteKind ?? undefined,
    introText: best.introText ?? undefined,
    scopeOfWork: best.scopeOfWork ?? undefined,
    systemInfo: best.systemInfo ?? undefined,
  });

  return NextResponse.json({
    quoteId: quote.id,
    matchedFromQuoteId: best.id,
    customerName: party.name,
    amountCents: quote.amountCents,
    reviewUrl: `/dashboard/${tenantId}/quotes/${quote.id}`,
  });
}
