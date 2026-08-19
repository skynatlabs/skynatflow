// Hit by Hostinger's Cron Jobs on a schedule (e.g. hourly). Finds every
// quote/invoice gone quiet past its threshold, across every tenant, and
// sends a follow-up. Uses the AI-drafted message (Phase 3) when
// ANTHROPIC_API_KEY is configured; falls back to a plain template
// otherwise, so this endpoint works before that checkpoint is resolved.

import { NextRequest, NextResponse } from "next/server";
import { findStaleTransactions } from "@/lib/core/money";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { logFollowUpSent, countFollowUpsSent } from "@/lib/core/movement";
import { draftFollowUpMessage, type StaleTransactionWithParty } from "@/lib/ai/followUp";
import { prisma } from "@/lib/db";

function templateFollowUpMessage(type: string, amountCents: number) {
  const amount = (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
  });
  return type === "QUOTE"
    ? `Hi! Just checking in on the quote for ${amount} we sent over — happy to answer any questions, or adjust it if needed.`
    : `Hi! This is a friendly reminder that your invoice for ${amount} is still outstanding. Let us know if you have any questions.`;
}

async function composeFollowUpMessage(
  tx: StaleTransactionWithParty,
  touchNumber: number
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return templateFollowUpMessage(tx.type, tx.amountCents);
  }
  try {
    return await draftFollowUpMessage({ transaction: tx, touchNumber });
  } catch (err) {
    // AI drafting failing should never block a follow-up from going out —
    // fall back to the template rather than silently skipping the customer.
    console.error("[follow-ups] AI draft failed, falling back to template:", err);
    return templateFollowUpMessage(tx.type, tx.amountCents);
  }
}

export async function GET(req: NextRequest) {
  // Basic shared-secret check so this endpoint can't be triggered by anyone
  // who finds the URL — set CRON_SECRET and pass it as a query param from
  // the Hostinger Cron Job command.
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany();
  let sent = 0;

  for (const tenant of tenants) {
    const stale = await findStaleTransactions({
      tenantId: tenant.id,
      staleAfterDays: 3,
    });

    for (const tx of stale) {
      if (!tx.party.phone) continue;

      const touchNumber = (await countFollowUpsSent(tx.id)) + 1;
      const body = await composeFollowUpMessage(tx, touchNumber);

      await sendWhatsAppMessage({ to: tx.party.phone, body });

      await logFollowUpSent({
        tenantId: tenant.id,
        partyId: tx.party.id,
        transactionId: tx.id,
        notes: `Follow-up #${touchNumber} sent on ${tx.type} ${tx.id}`,
      });

      sent++;
    }
  }

  return NextResponse.json({ ok: true, followUpsSent: sent });
}
