// Hit by Hostinger's Cron Jobs on a schedule (e.g. hourly). Finds every
// quote/invoice gone quiet past its threshold, across every tenant, and
// drafts a follow-up. By default this does NOT send it — the confirm-
// before-send guardrail: every draft lands as a pending AiDraft row,
// visible with its reasoning at /dashboard/[tenantId]/ai-drafts, and only
// goes out once the owner clicks Approve. When Tenant.autoRespondEnabled
// is on, it sends immediately instead — the guardrail made optional per
// tenant, not mandatory, for owners who want the daily task gone
// entirely. Cadence (window before first follow-up, days between
// repeats) is owner-controlled via Tenant.followUpWindowDays/
// followUpRepeatDays rather than the old hardcoded 3 days.

import { NextRequest, NextResponse } from "next/server";
import type { CollectionsTone } from "@prisma/client";
import { findStaleTransactions, findAbandonedQuotes } from "@/lib/core/money";
import { countFollowUpsSent, logFollowUpSent } from "@/lib/core/movement";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { createNotification } from "@/lib/core/notifications2";
import {
  draftFollowUpMessage,
  followUpReasoning,
  type StaleTransactionWithParty,
} from "@/lib/ai/followUp";
import { prisma } from "@/lib/db";

function templateFollowUpMessage(type: string, amountCents: number, tone: CollectionsTone) {
  const amount = (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
  });
  const doc = type === "QUOTE" ? "quote" : "invoice";
  if (tone === "FIRM") {
    return type === "QUOTE"
      ? `Hi — following up on the ${amount} quote we sent. Could you let us know your decision by end of week?`
      : `Hi — your invoice for ${amount} is still outstanding. Please could you confirm when we can expect payment?`;
  }
  return type === "QUOTE"
    ? `Hi! Just checking in on the ${doc} for ${amount} we sent over — happy to answer any questions, or adjust it if needed.`
    : `Hi! This is a friendly reminder that your ${doc} for ${amount} is still outstanding. Let us know if you have any questions.`;
}

async function composeFollowUpMessage(
  tx: StaleTransactionWithParty,
  touchNumber: number,
  tone: CollectionsTone
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return templateFollowUpMessage(tx.type, tx.amountCents, tone);
  }
  try {
    return await draftFollowUpMessage({ transaction: tx, touchNumber, tone });
  } catch (err) {
    // AI drafting failing should never block a follow-up from going out —
    // fall back to the template rather than silently skipping the customer.
    console.error("[follow-ups] AI draft failed, falling back to template:", err);
    return templateFollowUpMessage(tx.type, tx.amountCents, tone);
  }
}

// Creates the draft, then either leaves it PENDING (default) or sends it
// immediately and advances the transaction's next-follow-up date by the
// tenant's repeat cadence (autoRespondEnabled). Returns true if a draft
// was actually created (skips if one's already pending).
async function processTransaction(
  tenantId: string,
  tx: StaleTransactionWithParty,
  reasoning: string,
  autoRespond: boolean,
  repeatDays: number,
  tone: CollectionsTone
): Promise<boolean> {
  if (!tx.party.phone) return false;

  const existingPending = await prisma.aiDraft.findFirst({
    where: { transactionId: tx.id, status: "PENDING" },
  });
  if (existingPending) return false;

  const touchNumber = (await countFollowUpsSent(tx.id)) + 1;
  const body = await composeFollowUpMessage(tx, touchNumber, tone);

  const draft = await prisma.aiDraft.create({
    data: {
      tenantId,
      partyId: tx.party.id,
      transactionId: tx.id,
      touchNumber,
      body,
      reasoning,
      status: autoRespond ? "SENT" : "PENDING",
      resolvedAt: autoRespond ? new Date() : null,
    },
  });

  if (autoRespond) {
    await sendWhatsAppMessage({ to: tx.party.phone, body });
    await logFollowUpSent({
      tenantId,
      partyId: tx.party.id,
      transactionId: tx.id,
      notes: `Follow-up #${touchNumber} auto-sent (auto-respond enabled)`,
    });
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { nextFollowUpAt: new Date(Date.now() + repeatDays * 86400000) },
    });
    await createNotification({
      tenantId,
      type: "AUTO_FOLLOW_UP_SENT",
      title: `Follow-up auto-sent to ${tx.party.name}`,
      body: body.slice(0, 140),
      linkHref: `/dashboard/${tenantId}/customers/${tx.party.id}`,
    });
  }

  void draft;
  return true;
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
  let drafted = 0;
  let autoSent = 0;
  let abandonedDrafted = 0;

  for (const tenant of tenants) {
    const stale = await findStaleTransactions({
      tenantId: tenant.id,
      staleAfterDays: tenant.followUpWindowDays,
    });

    for (const tx of stale) {
      const created = await processTransaction(
        tenant.id,
        tx,
        followUpReasoning(await countFollowUpsSent(tx.id) + 1, tx.type, tenant.collectionsTone),
        tenant.autoRespondEnabled,
        tenant.followUpRepeatDays,
        tenant.collectionsTone
      );
      if (created) {
        drafted++;
        if (tenant.autoRespondEnabled) autoSent++;
      }
    }

    // Abandoned-quote recovery — opened but not yet responded to, and not
    // already caught by the stale-transaction pass above. This is the
    // ecommerce "abandoned cart" pattern applied to quotes, reusing the
    // exact same draft-then-approve pipeline as payment chasing.
    const abandoned = await findAbandonedQuotes({ tenantId: tenant.id, minHoursSinceOpen: 2 });

    for (const tx of abandoned) {
      const created = await processTransaction(
        tenant.id,
        tx,
        `They opened this quote (${tx.openCount}x) but haven't responded yet — worth a nudge while it's still fresh, rather than waiting for the standard follow-up cadence.`,
        tenant.autoRespondEnabled,
        tenant.followUpRepeatDays,
        tenant.collectionsTone
      );
      if (created) {
        abandonedDrafted++;
        if (tenant.autoRespondEnabled) autoSent++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    followUpsDrafted: drafted,
    abandonedQuotesDrafted: abandonedDrafted,
    autoSent,
  });
}
