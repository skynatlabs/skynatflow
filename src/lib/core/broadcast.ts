// One message to many people.
//
// The dangerous feature. Done badly it costs a business its WhatsApp number,
// which takes every conversation it was having with it — so the design is
// built around the skipped list rather than the sent one.
//
// A broadcast that quietly drops people who withdrew consent looks identical
// to one that never checked. So everybody left out is recorded with the
// reason, the reason is shown before sending rather than after, and the
// record is kept — because the question that follows a complaint is "who did
// you send it to and why did you think you could", and a business needs to be
// able to answer it.
//
// Nothing sends itself. Assembling a broadcast is safe; releasing one is a
// gated act.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { filterByConsent, type Channel, type Purpose, CHANNEL_LABEL } from "./consent";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { sendSms } from "@/lib/sms/client";
import { sendMail } from "./mailbox";

export interface Recipient {
  partyId: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface AudiencePreview {
  channel: Channel;
  purpose: Purpose;
  willReceive: Recipient[];
  skipped: Array<{ partyId: string; name: string; reason: string }>;
  /** Said before sending, not after. */
  summary: string;
}

/** Who this would actually reach, and who it would not. */
export async function previewAudience(params: {
  tenantId: string;
  channel: Channel;
  purpose: Purpose;
  /** Leave out for every customer on file. */
  partyIds?: string[];
}): Promise<AudiencePreview> {
  const parties = await prisma.party.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.partyIds ? { id: { in: params.partyIds } } : { role: { in: ["CUSTOMER", "PATIENT"] } }),
    },
    select: { id: true, name: true, companyName: true, phone: true, email: true },
    take: 2000,
  });

  const { allowed, skipped } = await filterByConsent({
    tenantId: params.tenantId,
    partyIds: parties.map((p) => p.id),
    channel: params.channel,
    purpose: params.purpose,
  });
  const allowedSet = new Set(allowed);
  const nameOf = new Map(parties.map((p) => [p.id, p.companyName ?? p.name]));

  const willReceive: Recipient[] = [];
  const cannotReach: Array<{ partyId: string; name: string; reason: string }> = [];

  for (const party of parties) {
    if (!allowedSet.has(party.id)) continue;
    // Consent without a way to reach them is not reach.
    const hasAddress = params.channel === "email" ? Boolean(party.email) : Boolean(party.phone);
    if (!hasAddress) {
      cannotReach.push({
        partyId: party.id,
        name: party.companyName ?? party.name,
        reason: params.channel === "email" ? "No email address on file." : "No phone number on file.",
      });
      continue;
    }
    willReceive.push({ partyId: party.id, name: party.companyName ?? party.name, phone: party.phone, email: party.email });
  }

  const allSkipped = [
    ...skipped.map((s) => ({ partyId: s.partyId, name: nameOf.get(s.partyId) ?? "Unknown", reason: s.reason })),
    ...cannotReach,
  ];

  return {
    channel: params.channel,
    purpose: params.purpose,
    willReceive,
    skipped: allSkipped,
    summary:
      `${willReceive.length} of ${parties.length} would receive this on ${CHANNEL_LABEL[params.channel]}` +
      (allSkipped.length > 0 ? `; ${allSkipped.length} left out, each for a reason listed below.` : "."),
  };
}

export async function draftBroadcast(params: {
  tenantId: string;
  channel: Channel;
  purpose: Purpose;
  subject?: string | null;
  body: string;
  partyIds?: string[];
  createdById?: string | null;
}) {
  if (!params.body.trim()) throw new Error("There is nothing in the message.");
  const audience = await previewAudience(params);

  return prisma.broadcast.create({
    data: {
      tenantId: params.tenantId,
      channel: params.channel,
      subject: params.subject?.trim() || null,
      body: params.body.trim(),
      audience: {
        purpose: params.purpose,
        sent: [],
        willReceive: audience.willReceive.map((r) => r.partyId),
        skipped: audience.skipped,
      } as unknown as Prisma.InputJsonValue,
      sentCount: 0,
      skippedCount: audience.skipped.length,
      createdById: params.createdById ?? null,
    },
  });
}

export interface SendOutcome {
  broadcastId: string;
  sent: number;
  failed: number;
  skipped: number;
  problems: string[];
}

/**
 * Release it.
 *
 * Consent is checked again here rather than trusted from the draft: somebody
 * may have replied STOP between assembling the message and pressing send, and
 * that reply is precisely the one that must not be ignored.
 */
export async function sendBroadcast(params: { tenantId: string; broadcastId: string }): Promise<SendOutcome> {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: params.broadcastId, tenantId: params.tenantId } });
  if (!broadcast) throw new Error("That broadcast is not in this workspace.");
  if (broadcast.status === "SENT") throw new Error("That broadcast has already gone out.");

  const stored = broadcast.audience as { purpose?: Purpose; willReceive?: string[] };
  const audience = await previewAudience({
    tenantId: params.tenantId,
    channel: broadcast.channel as Channel,
    purpose: stored.purpose ?? "marketing",
    partyIds: stored.willReceive,
  });

  const problems: string[] = [];
  const sent: string[] = [];
  let failed = 0;

  for (const recipient of audience.willReceive) {
    try {
      if (broadcast.channel === "whatsapp" && recipient.phone) {
        await sendWhatsAppMessage({ to: recipient.phone, body: broadcast.body });
      } else if (broadcast.channel === "sms" && recipient.phone) {
        await sendSms({ to: recipient.phone, body: broadcast.body });
      } else if (broadcast.channel === "email" && recipient.email) {
        await sendMail({
          tenantId: params.tenantId,
          to: recipient.email,
          subject: broadcast.subject ?? "A message",
          body: broadcast.body,
        });
      } else {
        throw new Error("No way to reach them on that channel.");
      }
      sent.push(recipient.partyId);
    } catch (err) {
      failed += 1;
      problems.push(`${recipient.name}: ${err instanceof Error ? err.message : "did not send"}`);
    }
  }

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      sentCount: sent.length,
      skippedCount: audience.skipped.length,
      audience: {
        purpose: stored.purpose ?? "marketing",
        sent,
        skipped: audience.skipped,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { broadcastId: broadcast.id, sent: sent.length, failed, skipped: audience.skipped.length, problems: problems.slice(0, 20) };
}

export async function listBroadcasts(tenantId: string) {
  const rows = await prisma.broadcast.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({
    ...r,
    skippedList: ((r.audience as { skipped?: Array<{ name: string; reason: string }> }).skipped ?? []).slice(0, 50),
  }));
}

export async function deleteDraftBroadcast(tenantId: string, broadcastId: string) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, tenantId }, select: { id: true, status: true } });
  if (!broadcast) throw new Error("That broadcast is not in this workspace.");
  if (broadcast.status === "SENT") throw new Error("A broadcast that has gone out is a record and stays.");
  return prisma.broadcast.delete({ where: { id: broadcastId } });
}
