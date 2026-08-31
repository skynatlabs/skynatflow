// Voice Q&A: the browser transcribes speech client-side (Web Speech
// Recognition — free, no API key), sends the text question here, and
// this answers it grounded in the tenant's actual real-time numbers —
// never a guess, always the same figures the dashboard itself shows.
// Falls back to a plain "I can't check that right now" if no AI provider
// is configured, same posture as every other AI feature in this app.

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getAiModel } from "@/lib/ai/model";
import { prisma } from "@/lib/db";
import { findStaleTransactions } from "@/lib/core/money";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await requireTenantAccess(tenantId);

  const { question } = await req.json();
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const model = await getAiModel();
  if (!model) {
    return NextResponse.json({ answer: "I can't check that right now — no AI provider is configured." });
  }

  const [tenant, stale, thisWeek, openInvoices, customerCount, quotes] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
    listThisWeekFollowUps(tenantId),
    prisma.transaction.findMany({ where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID"] } } }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.transaction.findMany({ where: { tenantId, type: "QUOTE" } }),
  ]);

  const context = [
    `Business: ${tenant.name}`,
    `Open invoices owed to the business: ${openInvoices.length}, totaling ${money(openInvoices.reduce((s, t) => s + t.amountCents, 0))}.`,
    `Quotes/invoices gone quiet needing a follow-up: ${stale.length}${stale.length ? " — " + stale.map((t) => `${t.party.name} (${money(t.amountCents)})`).join(", ") : ""}.`,
    `Reminders due this week: ${thisWeek.length}${thisWeek.length ? " — " + thisWeek.map((t) => `${t.party.name} on ${t.nextFollowUpAt?.toLocaleDateString()}${t.followUpNote ? ` (${t.followUpNote})` : ""}`).join("; ") : ""}.`,
    `Total customers on file: ${customerCount}.`,
    `Total quotes ever sent: ${quotes.length}, total value ${money(quotes.reduce((s, t) => s + t.amountCents, 0))}, accepted: ${quotes.filter((q) => q.status === "ACCEPTED").length}.`,
  ].join("\n");

  try {
    const { text } = await generateText({
      model,
      system:
        "You are a spoken voice assistant for a small business owner's dashboard. Answer their " +
        "question using ONLY the facts given below — never invent a number that isn't there. If the " +
        "facts don't answer the question, say so plainly. Keep the answer to 1-3 short sentences, " +
        "plain conversational language (this gets read aloud by text-to-speech) — no markdown, no " +
        "bullet points, no numbered lists.",
      prompt: `Today's business facts:\n${context}\n\nQuestion: ${question}`,
    });
    return NextResponse.json({ answer: text });
  } catch (err) {
    console.error("[voice-assistant] failed:", err);
    return NextResponse.json({ answer: "Sorry, I couldn't work that out just now." });
  }
}
