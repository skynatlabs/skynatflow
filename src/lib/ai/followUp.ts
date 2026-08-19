// Replaces the Phase 2 templated reminder with a genuinely AI-drafted one —
// same escalating-cadence logic, different message body. This is the
// concrete Phase 3 deliverable from the build manual.
//
// Needs ANTHROPIC_API_KEY to actually call the model; without it this
// throws clearly rather than silently sending a broken message, which is
// safer given every send here is customer-facing (see confirm-before-send
// guardrail, strategic report Section 6.4 — this function drafts, it does
// not itself decide to send without that check happening upstream).

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Transaction, Party } from "@prisma/client";

export interface StaleTransactionWithParty extends Transaction {
  party: Party;
}

export async function draftFollowUpMessage(params: {
  transaction: StaleTransactionWithParty;
  touchNumber: number; // 1st, 2nd, 3rd... follow-up — tone escalates with this
}) {
  const { transaction, touchNumber } = params;
  const amount = (transaction.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
  });

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system:
      "You draft short, warm, natural-sounding WhatsApp follow-up messages " +
      "for a small services business chasing an unanswered quote or unpaid " +
      "invoice. Never sound robotic or templated. Escalate politeness-to-" +
      "urgency gradually across touches: touch 1 is a gentle check-in, " +
      "touch 2 is a helpful nudge, touch 3+ is a direct, respectful request " +
      "for a decision or payment. One or two sentences. No greeting fluff " +
      "like 'I hope this finds you well.'",
    prompt:
      `Customer: ${transaction.party.name}\n` +
      `Document type: ${transaction.type}\n` +
      `Amount: ${amount}\n` +
      `This is follow-up touch #${touchNumber} — they have not responded ` +
      `since it was sent.\n\n` +
      `Draft the WhatsApp message.`,
  });

  return text.trim();
}
