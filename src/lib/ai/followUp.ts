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
import type { Transaction, Party, CollectionsTone } from "@prisma/client";

export interface StaleTransactionWithParty extends Transaction {
  party: Party;
}

// The owner-controlled empathy dial (Tenant.collectionsTone) — chase
// payment without torching the relationship. Shifts the whole escalation
// curve, not just the wording of one message: GENTLE never gets sharp
// even by touch 5+; FIRM gets direct sooner.
const TONE_GUIDANCE: Record<CollectionsTone, string> = {
  GENTLE:
    "Stay warm and understanding at every touch, even later ones — never " +
    "sound impatient or pressuring. Assume good faith (they're busy, not " +
    "avoiding you). The most direct you ever get is a polite, clear ask.",
  STANDARD:
    "Escalate politeness-to-urgency gradually across touches: touch 1 is a " +
    "gentle check-in, touch 2 is a helpful nudge, touch 3+ is a direct, " +
    "respectful request for a decision or payment.",
  FIRM:
    "Get to the point quickly. Touch 1 can still be a normal check-in, but " +
    "touch 2 onward should be direct and businesslike — clear about the " +
    "amount owed and asking for a specific commitment, while staying " +
    "professional and never rude.",
};

export async function draftFollowUpMessage(params: {
  transaction: StaleTransactionWithParty;
  touchNumber: number; // 1st, 2nd, 3rd... follow-up — tone escalates with this
  tone?: CollectionsTone;
}) {
  const { transaction, touchNumber, tone = "STANDARD" } = params;
  const amount = (transaction.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
  });

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system:
      "You draft short, warm, natural-sounding WhatsApp follow-up messages " +
      "for a small services business chasing an unanswered quote or unpaid " +
      "invoice. Never sound robotic or templated. One or two sentences. No " +
      "greeting fluff like 'I hope this finds you well.'\n\n" +
      TONE_GUIDANCE[tone],
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

// The tone rationale shown to the owner alongside the draft — deterministic
// from touchNumber rather than a second AI call, since it just needs to be
// honest about why this cadence was picked, not itself generated.
export function followUpReasoning(
  touchNumber: number,
  type: string,
  tone: CollectionsTone = "STANDARD"
): string {
  const doc = type === "QUOTE" ? "quote" : "invoice";
  const toneNote = tone !== "STANDARD" ? ` (${tone.toLowerCase()} tone, as set in Settings)` : "";
  if (touchNumber === 1) return `First follow-up — gentle check-in, no response yet on this ${doc}${toneNote}.`;
  if (touchNumber === 2 && tone !== "FIRM")
    return `Second follow-up — a helpful nudge, still no reply after touch #1${toneNote}.`;
  if (tone === "GENTLE")
    return `Follow-up #${touchNumber} — staying warm and assuming good faith, per your gentle tone setting.`;
  if (tone === "FIRM")
    return `Follow-up #${touchNumber} — direct and businesslike, per your firm tone setting.`;
  return `Follow-up #${touchNumber} — direct, respectful request for a decision after repeated silence.`;
}
