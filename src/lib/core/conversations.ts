// Who owns this conversation.
//
// The messages already existed. What did not was anybody being responsible
// for one — and a shared inbox without assignment is a pile everybody assumes
// somebody else is reading. Three things fix that, and they are small:
//
//   ASSIGNMENT. One name against a conversation. Not a queue, not a rota — a
//   person, so "who is answering this?" has an answer.
//
//   THE CLOCK. When the customer last wrote and has not been answered since.
//   It is what turns "we get back to people quickly" from a belief into a
//   number, and the number is usually a surprise.
//
//   SNOOZE. Because half of an inbox is things that are genuinely not due
//   yet, and the only alternative to snoozing them is leaving them looking
//   urgent until they are ignored along with everything else.
//
// Notes are separate from messages and never sent. The thing somebody needs
// to say about a customer is rarely the thing they would say to them.

import { prisma } from "@/lib/db";

export type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";

export interface ConversationView {
  id: string;
  threadKey: string;
  partyId: string | null;
  customer: string | null;
  status: ConversationStatus;
  assignedToId: string | null;
  assignedTo: string | null;
  snoozedUntil: Date | null;
  waitingSince: Date | null;
  /** Hours the customer has been waiting on an answer. The clock. */
  waitingHours: number | null;
  firstReplyMins: number | null;
  noteCount: number;
}

/** The conversation for a thread, made if it is not there yet. */
export async function conversationFor(params: { tenantId: string; threadKey: string; partyId?: string | null }) {
  return prisma.conversation.upsert({
    where: { tenantId_threadKey: { tenantId: params.tenantId, threadKey: params.threadKey } },
    create: { tenantId: params.tenantId, threadKey: params.threadKey, partyId: params.partyId ?? null },
    update: params.partyId ? { partyId: params.partyId } : {},
  });
}

/**
 * The customer wrote. Start the clock, and reopen anything closed.
 *
 * Reopening is deliberate: somebody replying to a conversation marked done is
 * the single most common way an answer gets lost, because the thread is no
 * longer anywhere anybody looks.
 */
export async function customerWrote(params: { tenantId: string; threadKey: string; partyId?: string | null; at?: Date }) {
  const at = params.at ?? new Date();
  const conversation = await conversationFor(params);
  if (conversation.waitingSince && conversation.status === "OPEN") return conversation;

  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "OPEN", waitingSince: conversation.waitingSince ?? at, snoozedUntil: null, closedAt: null, closedById: null },
  });
}

/** We answered. Stop the clock, and record how long the first answer took. */
export async function weAnswered(params: { tenantId: string; threadKey: string; at?: Date }) {
  const at = params.at ?? new Date();
  const conversation = await prisma.conversation.findUnique({
    where: { tenantId_threadKey: { tenantId: params.tenantId, threadKey: params.threadKey } },
  });
  if (!conversation) return null;

  const mins =
    conversation.firstReplyMins === null && conversation.waitingSince
      ? Math.max(0, Math.round((at.getTime() - conversation.waitingSince.getTime()) / 60_000))
      : conversation.firstReplyMins;

  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { waitingSince: null, firstReplyMins: mins },
  });
}

export async function assign(params: { tenantId: string; threadKey: string; membershipId: string | null }) {
  if (params.membershipId) {
    const member = await prisma.membership.findFirst({
      where: { id: params.membershipId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!member) throw new Error("That person is not on this workspace.");
  }
  const conversation = await conversationFor({ tenantId: params.tenantId, threadKey: params.threadKey });
  return prisma.conversation.update({ where: { id: conversation.id }, data: { assignedToId: params.membershipId } });
}

export async function snooze(params: { tenantId: string; threadKey: string; until: Date }) {
  if (params.until <= new Date()) throw new Error("Snoozing until a moment that has passed does nothing.");
  const conversation = await conversationFor({ tenantId: params.tenantId, threadKey: params.threadKey });
  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "SNOOZED", snoozedUntil: params.until },
  });
}

export async function closeConversation(params: { tenantId: string; threadKey: string; closedById?: string | null }) {
  const conversation = await conversationFor({ tenantId: params.tenantId, threadKey: params.threadKey });
  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: params.closedById ?? null, waitingSince: null, snoozedUntil: null },
  });
}

export async function reopen(params: { tenantId: string; threadKey: string }) {
  const conversation = await conversationFor({ tenantId: params.tenantId, threadKey: params.threadKey });
  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "OPEN", closedAt: null, closedById: null, snoozedUntil: null },
  });
}

export async function addConversationNote(params: {
  tenantId: string;
  threadKey: string;
  body: string;
  authorId?: string | null;
}) {
  if (!params.body.trim()) throw new Error("There is nothing in the note.");
  const conversation = await conversationFor({ tenantId: params.tenantId, threadKey: params.threadKey });
  return prisma.conversationNote.create({
    data: { conversationId: conversation.id, body: params.body.trim(), authorId: params.authorId ?? null },
  });
}

export async function conversationNotes(tenantId: string, threadKey: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { tenantId_threadKey: { tenantId, threadKey } },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!conversation) return [];

  const authorIds = [...new Set(conversation.notes.map((n) => n.authorId).filter(Boolean) as string[])];
  const members = await prisma.membership.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  const nameOf = new Map(members.map((m) => [m.id, m.user.name ?? m.user.email]));

  return conversation.notes.map((n) => ({ ...n, authorName: n.authorId ? nameOf.get(n.authorId) ?? null : null }));
}

/**
 * Snoozed conversations whose moment has come.
 *
 * Called by the tick. A snooze that never wakes up is just a slower way of
 * losing something.
 */
export async function wakeSnoozed(tenantId: string, now = new Date()) {
  const { count } = await prisma.conversation.updateMany({
    where: { tenantId, status: "SNOOZED", snoozedUntil: { not: null, lte: now } },
    data: { status: "OPEN", snoozedUntil: null },
  });
  return count;
}

export async function listConversations(
  tenantId: string,
  opts: { status?: ConversationStatus; assignedToId?: string | null; now?: Date } = {}
): Promise<ConversationView[]> {
  const now = opts.now ?? new Date();
  const rows = await prisma.conversation.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.assignedToId !== undefined ? { assignedToId: opts.assignedToId } : {}),
    },
    orderBy: [{ waitingSince: "asc" }, { updatedAt: "desc" }],
    take: 200,
    include: { party: { select: { name: true, companyName: true } }, notes: { select: { id: true } } },
  });

  const memberIds = [...new Set(rows.map((r) => r.assignedToId).filter(Boolean) as string[])];
  const members = await prisma.membership.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  const nameOf = new Map(members.map((m) => [m.id, m.user.name ?? m.user.email]));

  return rows.map((r) => ({
    id: r.id,
    threadKey: r.threadKey,
    partyId: r.partyId,
    customer: r.party ? r.party.companyName ?? r.party.name : null,
    status: r.status as ConversationStatus,
    assignedToId: r.assignedToId,
    assignedTo: r.assignedToId ? nameOf.get(r.assignedToId) ?? null : null,
    snoozedUntil: r.snoozedUntil,
    waitingSince: r.waitingSince,
    waitingHours: r.waitingSince ? Math.floor((now.getTime() - r.waitingSince.getTime()) / 3_600_000) : null,
    firstReplyMins: r.firstReplyMins,
    noteCount: r.notes.length,
  }));
}

/**
 * How well this business answers people.
 *
 * The median rather than the mean: one conversation somebody forgot about for
 * three weeks should not be allowed to describe the other forty.
 */
export async function responseHealth(tenantId: string, now = new Date()) {
  const rows = await prisma.conversation.findMany({
    where: { tenantId },
    select: { firstReplyMins: true, waitingSince: true, status: true, assignedToId: true },
  });

  const replied = rows.map((r) => r.firstReplyMins).filter((m): m is number => m !== null).sort((a, b) => a - b);
  const median = replied.length === 0 ? null : replied[Math.floor(replied.length / 2)];
  const waiting = rows.filter((r) => r.waitingSince !== null);
  const longest = waiting.reduce((worst, r) => {
    const hours = Math.floor((now.getTime() - r.waitingSince!.getTime()) / 3_600_000);
    return hours > worst ? hours : worst;
  }, 0);

  return {
    open: rows.filter((r) => r.status === "OPEN").length,
    waiting: waiting.length,
    unassigned: rows.filter((r) => r.status === "OPEN" && !r.assignedToId).length,
    medianFirstReplyMins: median,
    longestWaitHours: longest,
    summary:
      waiting.length === 0
        ? "Nobody is waiting on an answer."
        : `${waiting.length} ${waiting.length === 1 ? "person is" : "people are"} waiting on an answer` +
          (longest >= 24 ? `, the longest for ${Math.floor(longest / 24)} days.` : `, the longest for ${longest} hours.`) +
          (median !== null ? ` Usually answered in ${median < 60 ? `${median} minutes` : `${Math.round(median / 60)} hours`}.` : ""),
  };
}
