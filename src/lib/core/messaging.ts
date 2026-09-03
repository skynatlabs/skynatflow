// 1:1 and group messaging, plus threads scoped to a task/job card.
// Polling-based reads for v1 — the whole dashboard already works this way
// (server components + revalidatePath), no websocket infra needed to ship
// something genuinely useful here.

import { prisma } from "@/lib/db";

export async function getOrCreateDmThread(tenantId: string, memberA: string, memberB: string) {
  const participantIds = [memberA, memberB].sort();
  const existing = await prisma.messageThread.findFirst({
    where: { tenantId, name: null, participantIds: { equals: participantIds } },
  });
  if (existing) return existing;

  return prisma.messageThread.create({
    data: { tenantId, participantIds, name: null },
  });
}

export async function createGroupThread(params: {
  tenantId: string;
  name: string;
  participantIds: string[];
  taskId?: string;
}) {
  return prisma.messageThread.create({
    data: {
      tenantId: params.tenantId,
      name: params.name,
      participantIds: params.participantIds,
      taskId: params.taskId,
    },
  });
}

async function requireOwnedThread(tenantId: string, threadId: string) {
  const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.tenantId !== tenantId) throw new Error("Conversation not found.");
  return thread;
}

export async function sendMessage(params: { tenantId: string; threadId: string; authorId: string; body: string }) {
  await requireOwnedThread(params.tenantId, params.threadId);
  return prisma.message.create({
    data: { threadId: params.threadId, authorId: params.authorId, body: params.body },
  });
}

export async function listThreadsForMember(tenantId: string, membershipId: string) {
  const threads = await prisma.messageThread.findMany({
    where: { tenantId, participantIds: { has: membershipId } },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const allParticipantIds = Array.from(new Set(threads.flatMap((t) => t.participantIds)));
  const memberships = await prisma.membership.findMany({
    where: { id: { in: allParticipantIds } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));

  return threads.map((t) => ({
    id: t.id,
    name: t.name ?? t.participantIds.filter((id) => id !== membershipId).map((id) => nameById.get(id) ?? "Someone").join(", "),
    taskId: t.taskId,
    lastMessage: t.messages[0]?.body ?? null,
    lastMessageAt: t.messages[0]?.createdAt ?? t.createdAt,
  }));
}

export async function listMessages(tenantId: string, threadId: string) {
  const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.tenantId !== tenantId) return null;

  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: messages.map((m) => m.authorId) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return messages.map((m) => ({ ...m, authorName: nameById.get(m.authorId) ?? "Someone" }));
}
