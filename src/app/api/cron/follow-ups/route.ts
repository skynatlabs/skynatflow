// Hit by Hostinger's Cron Jobs on a schedule (e.g. hourly). Finds every
// quote/invoice gone quiet past its threshold, across every tenant, and
// drafts a follow-up — but does NOT send it. This is the confirm-before-
// send guardrail made real: every draft lands as a pending AiDraft row,
// visible with its reasoning at /dashboard/[tenantId]/ai-drafts, and only
// goes out once the owner clicks Approve. Uses the AI-drafted message
// (Phase 3) when ANTHROPIC_API_KEY is configured; falls back to a plain
// template otherwise, so this endpoint works before that checkpoint is
// resolved.

import { NextRequest, NextResponse } from "next/server";
import type { CollectionsTone } from "@prisma/client";
import { findStaleTransactions, findAbandonedQuotes } from "@/lib/core/money";
import { countFollowUpsSent } from "@/lib/core/movement";
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
  let abandonedDrafted = 0;

  for (const tenant of tenants) {
    const stale = await findStaleTransactions({
      tenantId: tenant.id,
      staleAfterDays: 3,
    });

    for (const tx of stale) {
      if (!tx.party.phone) continue;

      // Don't pile up a second pending draft for the same transaction —
      // one open ask at a time, wait for the owner to act on it.
      const existingPending = await prisma.aiDraft.findFirst({
        where: { transactionId: tx.id, status: "PENDING" },
      });
      if (existingPending) continue;

      const touchNumber = (await countFollowUpsSent(tx.id)) + 1;
      const body = await composeFollowUpMessage(tx, touchNumber, tenant.collectionsTone);

      await prisma.aiDraft.create({
        data: {
          tenantId: tenant.id,
          partyId: tx.party.id,
          transactionId: tx.id,
          touchNumber,
          body,
          reasoning: followUpReasoning(touchNumber, tx.type, tenant.collectionsTone),
        },
      });

      drafted++;
    }

    // Abandoned-quote recovery — opened but not yet responded to, and not
    // already caught by the stale-transaction pass above. This is the
    // ecommerce "abandoned cart" pattern applied to quotes, reusing the
    // exact same draft-then-approve pipeline as payment chasing.
    const abandoned = await findAbandonedQuotes({ tenantId: tenant.id, minHoursSinceOpen: 2 });

    for (const tx of abandoned) {
      if (!tx.party.phone) continue;

      const existingPending = await prisma.aiDraft.findFirst({
        where: { transactionId: tx.id, status: "PENDING" },
      });
      if (existingPending) continue;

      const touchNumber = (await countFollowUpsSent(tx.id)) + 1;
      const body = await composeFollowUpMessage(tx, touchNumber, tenant.collectionsTone);

      await prisma.aiDraft.create({
        data: {
          tenantId: tenant.id,
          partyId: tx.party.id,
          transactionId: tx.id,
          touchNumber,
          body,
          reasoning: `They opened this quote (${tx.openCount}x) but haven't responded yet — worth a nudge while it's still fresh, rather than waiting for the standard follow-up cadence.`,
        },
      });

      abandonedDrafted++;
    }
  }

  return NextResponse.json({ ok: true, followUpsDrafted: drafted, abandonedQuotesDrafted: abandonedDrafted });
}
