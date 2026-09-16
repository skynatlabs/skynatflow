// The phone.
//
// A missed call is the most expensive event in a small business's day and the
// only one nothing records. Somebody rings a plumber, it goes unanswered, they
// ring the next plumber, and the first one never learns it happened. Answering
// within the minute — "sorry we missed you, what do you need?" — is the single
// highest-return automation in this category, and it needs exactly two things:
// somewhere to record that the call happened, and a rule about what to send.
//
// Telephony providers are declared honestly. None has an adapter here yet:
// each needs a number provisioned and a webhook pointed at this app, so what
// exists is the record, the rule, and the endpoint they post to.

import { prisma } from "@/lib/db";
import { findPartyByPhone } from "./parties";
import { mayContact } from "./consent";
import { createNotification } from "./notifications2";

export interface TelephonyProvider {
  key: string;
  label: string;
  region: string;
  needs: string;
}

export const TELEPHONY_PROVIDERS: TelephonyProvider[] = [
  { key: "twilio", label: "Twilio", region: "Worldwide", needs: "A Twilio number with its status callback pointed at this workspace." },
  { key: "clickatell", label: "Clickatell", region: "South Africa", needs: "A Clickatell account with voice enabled." },
  { key: "telnyx", label: "Telnyx", region: "Worldwide", needs: "A Telnyx number and a call-control application." },
];

export type CallDirection = "in" | "out";
export type CallStatus = "answered" | "missed" | "voicemail";

/** Match a number to somebody on file, however either was written down. */
export async function partyForNumber(tenantId: string, number: string) {
  return findPartyByPhone(tenantId, number);
}

export async function logCall(params: {
  tenantId: string;
  fromNumber: string;
  toNumber: string;
  direction: CallDirection;
  status: CallStatus;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  summary?: string | null;
  startedAt?: Date;
}) {
  const theirNumber = params.direction === "in" ? params.fromNumber : params.toNumber;
  const party = await partyForNumber(params.tenantId, theirNumber);

  return prisma.callLog.create({
    data: {
      tenantId: params.tenantId,
      partyId: party?.id ?? null,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      direction: params.direction,
      status: params.status,
      durationSeconds: params.durationSeconds ?? null,
      recordingUrl: params.recordingUrl ?? null,
      summary: params.summary?.trim() || null,
      startedAt: params.startedAt ?? new Date(),
    },
  });
}

/** What goes back when a call is missed. Fixed wording, so nothing surprising goes out. */
export function missedCallReply(params: { businessName: string; callerKnown: boolean; name?: string | null }): string {
  return params.callerKnown && params.name
    ? `Hi ${params.name}, sorry we missed your call — ${params.businessName} here. What do you need? Reply here and we will come straight back to you.`
    : `Sorry we missed your call — ${params.businessName} here. Tell us what you need and we will come straight back to you.`;
}

export interface MissedCallOutcome {
  callId: string;
  /** Null when nothing was sent, with the reason said plainly. */
  sent: string | null;
  reason: string;
  partyId: string | null;
}

/**
 * Answer a missed call with a message.
 *
 * Deliberately does not send: it decides, and hands the wording back. The
 * actual send goes through whichever channel the workspace has configured,
 * and that is a gated act like every other outbound message. What is
 * automatic is the decision and the record, not the speaking.
 */
export async function handleMissedCall(params: { tenantId: string; callId: string }): Promise<MissedCallOutcome> {
  const call = await prisma.callLog.findFirst({
    where: { id: params.callId, tenantId: params.tenantId },
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });
  if (!call) throw new Error("That call is not in this workspace.");
  if (call.status !== "missed") return { callId: call.id, sent: null, reason: "That call was answered.", partyId: call.partyId };
  if (call.respondedAt) return { callId: call.id, sent: null, reason: "Already answered with a message.", partyId: call.partyId };

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true } });

  // A missed call is somebody trying to reach this business about their own
  // business with it, so it is service rather than marketing — but a withdrawn
  // consent still stops it, because "do not message me" means that.
  if (call.partyId) {
    const verdict = await mayContact({ tenantId: params.tenantId, partyId: call.partyId, channel: "whatsapp", purpose: "service" });
    if (!verdict.allowed) return { callId: call.id, sent: null, reason: verdict.reason, partyId: call.partyId };
  }

  const body = missedCallReply({
    businessName: tenant.name,
    callerKnown: Boolean(call.party),
    name: call.party?.name ?? null,
  });

  await createNotification({
    tenantId: params.tenantId,
    type: "GENERAL",
    title: `Missed call from ${call.party?.companyName ?? call.party?.name ?? call.fromNumber}`,
    body,
    linkHref: `/dashboard/${params.tenantId}/inbox`,
  });

  return { callId: call.id, sent: body, reason: "Missed, and somebody is waiting to hear back.", partyId: call.partyId };
}

/** Record that the missed call was answered, however it was answered. */
export async function markCallResponded(params: { tenantId: string; callId: string; with: string }) {
  const call = await prisma.callLog.findFirst({ where: { id: params.callId, tenantId: params.tenantId }, select: { id: true } });
  if (!call) throw new Error("That call is not in this workspace.");
  return prisma.callLog.update({
    where: { id: call.id },
    data: { respondedAt: new Date(), respondedWith: params.with },
  });
}

export async function listCalls(tenantId: string, opts: { partyId?: string; status?: CallStatus; take?: number } = {}) {
  return prisma.callLog.findMany({
    where: { tenantId, ...(opts.partyId ? { partyId: opts.partyId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { startedAt: "desc" },
    take: opts.take ?? 100,
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });
}

/** Missed calls nobody has answered. The list that costs money to ignore. */
export async function unansweredMissedCalls(tenantId: string, since?: Date) {
  return prisma.callLog.findMany({
    where: {
      tenantId,
      status: "missed",
      respondedAt: null,
      startedAt: { gte: since ?? new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { startedAt: "desc" },
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });
}

export async function callHealth(tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const calls = await prisma.callLog.findMany({
    where: { tenantId, startedAt: { gte: since } },
    select: { status: true, direction: true, respondedAt: true, startedAt: true },
  });

  const missed = calls.filter((c) => c.status === "missed" && c.direction === "in");
  const answeredBack = missed.filter((c) => c.respondedAt !== null);
  const inbound = calls.filter((c) => c.direction === "in").length;

  return {
    days,
    inbound,
    missed: missed.length,
    missedAndAnswered: answeredBack.length,
    missedAndIgnored: missed.length - answeredBack.length,
    missRatePercent: inbound === 0 ? 0 : Math.round((missed.length / inbound) * 100),
    summary:
      inbound === 0
        ? "No calls recorded. Point a number at this workspace and they land here."
        : `${missed.length} of ${inbound} incoming calls were missed in ${days} days` +
          (missed.length > 0
            ? `, and ${missed.length - answeredBack.length} of those were never followed up.`
            : "."),
  };
}
