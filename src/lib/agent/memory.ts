// What the agent remembers between runs.
//
// Three layers, deliberately separate because they have different lifetimes
// and different trust:
//
//   thread    — this conversation. Short, per-user, disposable.
//   facts     — durable things about the workspace that no query can derive
//               ("Riverside always pays EFT, 30 days"). Survives forever.
//   runs      — the audit trail. Never edited, only appended.
//
// Facts are what stop the agent restarting as a stranger every morning, and
// they are the piece a plain chatbot never has.

import { prisma } from "@/lib/db";

const MAX_THREAD_TURNS = 20;
const MAX_FACTS_IN_PROMPT = 40;

export interface ThreadTurn {
  role: "user" | "assistant";
  content: string;
}

/** Finds or starts the conversation this request belongs to. */
export async function resolveThread(params: {
  tenantId: string;
  userId?: string | null;
  threadId?: string | null;
  channel?: string;
}): Promise<string> {
  const { tenantId, userId, threadId, channel = "web" } = params;

  if (threadId) {
    // Scoped lookup: a thread id from the client must belong to this tenant.
    const existing = await prisma.agentThread.findFirst({
      where: { id: threadId, tenantId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const created = await prisma.agentThread.create({
    data: { tenantId, userId: userId ?? null, channel },
    select: { id: true },
  });
  return created.id;
}

export async function loadThread(threadId: string, tenantId: string): Promise<ThreadTurn[]> {
  const messages = await prisma.agentMessage.findMany({
    where: { threadId, thread: { tenantId } },
    orderBy: { createdAt: "asc" },
    take: MAX_THREAD_TURNS,
    select: { role: true, content: true },
  });
  return messages
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

export async function appendToThread(
  threadId: string,
  turns: ThreadTurn[]
): Promise<void> {
  if (turns.length === 0) return;
  await prisma.agentMessage.createMany({
    data: turns.map((t) => ({ threadId, role: t.role, content: t.content })),
  });
  await prisma.agentThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });
}

/** Durable workspace knowledge, rendered for the system prompt. */
export async function loadFacts(tenantId: string): Promise<string[]> {
  const facts = await prisma.tenantFact.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: MAX_FACTS_IN_PROMPT,
    select: { key: true, value: true },
  });
  return facts.map((f) => `${f.key}: ${f.value}`);
}

/**
 * Upsert by key so a fact that changes is corrected rather than duplicated —
 * "Acme pays late" becoming "Acme pays on time since March" must replace, not
 * accumulate alongside, or the prompt fills with contradictions.
 */
export async function rememberFact(params: {
  tenantId: string;
  key: string;
  value: string;
  sourceRunId?: string;
  confidence?: "observed" | "confirmed" | "stated";
}): Promise<void> {
  const { tenantId, key, value, sourceRunId, confidence = "observed" } = params;
  await prisma.tenantFact.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value, sourceRunId, confidence },
    update: { value, sourceRunId, confidence },
  });
}

export async function forgetFact(tenantId: string, key: string): Promise<void> {
  await prisma.tenantFact.deleteMany({ where: { tenantId, key } });
}
