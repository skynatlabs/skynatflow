// May we contact them.
//
// POPIA, GDPR and their equivalents turn this from a nicety into the thing
// that decides whether a message is marketing or a fine. But the practical
// reason to have it is smaller and more immediate: a business that burns its
// WhatsApp number on people who never asked loses the number, and with it
// every conversation it was having.
//
// Two rules that are easy to get wrong:
//
//   Consent is per channel. Somebody happy to receive an invoice by email is
//   not thereby happy to receive a special offer by WhatsApp, and treating
//   one as the other is exactly the complaint that gets a number blocked.
//
//   Silence is not consent for marketing, and is fine for service. Sending
//   somebody their own invoice needs no opt-in; telling them about a sale
//   does. So the check takes what the message is for, not just the channel.

import { prisma } from "@/lib/db";
import { findPartyByPhone } from "./parties";

export type Channel = "whatsapp" | "sms" | "email" | "call";
export type ConsentState = "granted" | "withdrawn";

/** What the message is for. The distinction the law actually draws. */
export type Purpose =
  /** Their own invoice, their delivery, an answer to their question. */
  | "service"
  /** Anything they did not ask for. */
  | "marketing";

export const CHANNELS: Channel[] = ["whatsapp", "sms", "email", "call"];

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  call: "Phone calls",
};

export async function setConsent(params: {
  tenantId: string;
  partyId: string;
  channel: Channel;
  state: ConsentState;
  source?: string | null;
  note?: string | null;
}) {
  const party = await prisma.party.findFirst({ where: { id: params.partyId, tenantId: params.tenantId }, select: { id: true } });
  if (!party) throw new Error("That customer is not in this workspace.");
  if (!CHANNELS.includes(params.channel)) throw new Error("There is no such channel.");

  return prisma.contactConsent.upsert({
    where: { tenantId_partyId_channel: { tenantId: params.tenantId, partyId: params.partyId, channel: params.channel } },
    create: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      channel: params.channel,
      state: params.state,
      source: params.source?.trim() || null,
      note: params.note?.trim() || null,
    },
    update: {
      state: params.state,
      source: params.source?.trim() || undefined,
      note: params.note?.trim() || undefined,
      changedAt: new Date(),
    },
  });
}

/** Everything on record for one person, by channel. */
export async function consentFor(tenantId: string, partyId: string): Promise<Record<Channel, { state: ConsentState | null; source: string | null; changedAt: Date | null }>> {
  const rows = await prisma.contactConsent.findMany({ where: { tenantId, partyId } });
  const out = {} as Record<Channel, { state: ConsentState | null; source: string | null; changedAt: Date | null }>;
  for (const channel of CHANNELS) {
    const row = rows.find((r) => r.channel === channel);
    out[channel] = row
      ? { state: row.state as ConsentState, source: row.source, changedAt: row.changedAt }
      : { state: null, source: null, changedAt: null };
  }
  return out;
}

export interface ConsentVerdict {
  allowed: boolean;
  /** Said plainly, because this reason gets shown to the person sending. */
  reason: string;
}

/**
 * May this message go?
 *
 * Service messages go unless somebody has explicitly said stop. Marketing
 * needs an explicit yes — silence is not consent, and a business that treats
 * it as one is one complaint away from losing the channel.
 */
export async function mayContact(params: {
  tenantId: string;
  partyId: string;
  channel: Channel;
  purpose: Purpose;
}): Promise<ConsentVerdict> {
  const row = await prisma.contactConsent.findUnique({
    where: { tenantId_partyId_channel: { tenantId: params.tenantId, partyId: params.partyId, channel: params.channel } },
  });

  if (row?.state === "withdrawn") {
    return { allowed: false, reason: `They asked not to be contacted on ${CHANNEL_LABEL[params.channel]}.` };
  }
  if (params.purpose === "service") {
    return { allowed: true, reason: "About their own work, so no opt-in is needed." };
  }
  if (row?.state === "granted") {
    return { allowed: true, reason: `They opted in${row.source ? ` — ${row.source}` : ""}.` };
  }
  return { allowed: false, reason: `No opt-in on record for ${CHANNEL_LABEL[params.channel]}, and this is not about their own work.` };
}

/** The same question for a list, in one pass. For a broadcast. */
export async function filterByConsent(params: {
  tenantId: string;
  partyIds: string[];
  channel: Channel;
  purpose: Purpose;
}): Promise<{ allowed: string[]; skipped: Array<{ partyId: string; reason: string }> }> {
  const rows = await prisma.contactConsent.findMany({
    where: { tenantId: params.tenantId, partyId: { in: params.partyIds }, channel: params.channel },
  });
  const byParty = new Map(rows.map((r) => [r.partyId, r]));

  const allowed: string[] = [];
  const skipped: Array<{ partyId: string; reason: string }> = [];
  for (const partyId of params.partyIds) {
    const row = byParty.get(partyId);
    if (row?.state === "withdrawn") {
      skipped.push({ partyId, reason: `Asked not to be contacted on ${CHANNEL_LABEL[params.channel]}.` });
    } else if (params.purpose === "service" || row?.state === "granted") {
      allowed.push(partyId);
    } else {
      skipped.push({ partyId, reason: "No opt-in on record." });
    }
  }
  return { allowed, skipped };
}

/** Somebody replied STOP. The one path that must never fail quietly. */
export async function withdrawByReply(params: { tenantId: string; channel: Channel; from: string }) {
  const party =
    params.channel === "email"
      ? await prisma.party.findFirst({ where: { tenantId: params.tenantId, email: { equals: params.from, mode: "insensitive" } } })
      : await findPartyByPhone(params.tenantId, params.from);

  if (!party) return { withdrawn: false, reason: "Nobody on file with that address or number." };
  await setConsent({
    tenantId: params.tenantId,
    partyId: party.id,
    channel: params.channel,
    state: "withdrawn",
    source: "They replied asking to stop",
  });
  return { withdrawn: true, partyId: party.id, name: party.name };
}

/** Does a reply mean stop? Generous on purpose — a missed opt-out is the costly error. */
export function readsAsOptOut(body: string): boolean {
  const text = body.trim().toLowerCase();
  if (text.length > 40) return false;
  return /^(stop|unsubscribe|opt ?out|remove me|no more|cancel|halt|end)\b/.test(text);
}

/** How the list stands, for the settings screen and the brief. */
export async function consentSummary(tenantId: string) {
  const [rows, customers] = await Promise.all([
    prisma.contactConsent.groupBy({ by: ["channel", "state"], where: { tenantId }, _count: { _all: true } }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
  ]);

  return CHANNELS.map((channel) => {
    const granted = rows.find((r) => r.channel === channel && r.state === "granted")?._count._all ?? 0;
    const withdrawn = rows.find((r) => r.channel === channel && r.state === "withdrawn")?._count._all ?? 0;
    return {
      channel,
      label: CHANNEL_LABEL[channel],
      granted,
      withdrawn,
      unasked: Math.max(0, customers - granted - withdrawn),
    };
  });
}
