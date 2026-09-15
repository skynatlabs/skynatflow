// Named agents.
//
// Once one agent loop works, a "collections agent" is configuration rather
// than engineering: a brief, a subset of tools, an autonomy level and a
// schedule. This is the surface that competes with ClickUp's Super Agents —
// except attached to a real ledger instead of a task board.
//
// Deliberately not a workflow builder. The owner writes what the agent is
// for in their own words; the loop works out how. A rule builder would put
// us back where the intent classifier was — only able to do what someone
// enumerated in advance.

import type { AgentAutonomy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { runAgent } from "@/lib/agent/runtime";
import { agentToolNames } from "@/lib/agent/tools";

/** Starting points an owner can adopt and then edit. */
export const AGENT_TEMPLATES = [
  {
    name: "Collections",
    brief:
      "Chase money that is owed. Find invoices that are overdue or have gone quiet, work out " +
      "who is worth chasing first by size and by how late they are, and draft a follow-up for " +
      "each that matches how that customer has been treated before. Never be rude to a good " +
      "payer who is a few days late.",
    toolNames: ["findStaleDocuments", "customerHistory", "customerBalance", "findCustomers", "createTask"],
    schedule: "0 9 * * 1-5",
  },
  {
    name: "Quote follow-up",
    brief:
      "Watch quotes that were sent but not answered. Pay particular attention to any a customer " +
      "has opened more than once without replying — that is someone deciding. Tell the owner who " +
      "to call, and why that one is worth the call today.",
    toolNames: ["findStaleDocuments", "customerHistory", "findCustomers", "createTask"],
    schedule: "0 8 * * 1-5",
  },
  {
    name: "Stock watch",
    brief:
      "Keep the shelves right. Watch for products at or below their reorder point, and for " +
      "anything selling fast enough to run out before a normal reorder would arrive. Raise what " +
      "to order and roughly how much.",
    toolNames: ["listProducts", "businessSnapshot", "createTask"],
    schedule: "0 7 * * 1",
  },
  {
    name: "Bookkeeper",
    brief:
      "Keep the books current and hand the owner a month-end pack. Each run: post whatever " +
      "documents have not reached the journal, run the month's depreciation, propose bank " +
      "matches, raise the tax provisions, and list what stands between the month and being " +
      "closed. Never close a month yourself and never post money nobody has seen — say what " +
      "needs a decision and why.",
    toolNames: ["monthEndPack", "cashFlowStatement", "taxPosition", "possibleDuplicateCosts", "createTask"],
    schedule: "0 7 1 * *",
  },
  {
    name: "Morning brief",
    brief:
      "Give the owner one short read on the business each morning: money in and out, what " +
      "changed since yesterday, and the single most useful thing they could do today. Keep it " +
      "to a few lines — if nothing has really changed, say so rather than padding.",
    toolNames: [],
    schedule: "0 6 * * 1-5",
  },
] as const;

export async function listAgents(tenantId: string) {
  return prisma.agentDefinition.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createAgent(params: {
  tenantId: string;
  name: string;
  brief: string;
  toolNames?: string[];
  autonomy?: AgentAutonomy;
  schedule?: string | null;
}) {
  return prisma.agentDefinition.create({
    data: {
      tenantId: params.tenantId,
      name: params.name,
      brief: params.brief,
      toolNames: params.toolNames ?? [],
      autonomy: params.autonomy ?? "SUGGEST_ONLY",
      schedule: params.schedule ?? null,
    },
  });
}

export async function setAgentActive(tenantId: string, agentId: string, isActive: boolean) {
  const updated = await prisma.agentDefinition.updateMany({
    where: { id: agentId, tenantId },
    data: { isActive },
  });
  if (updated.count === 0) throw new Error("Agent not found.");
}

export async function deleteAgent(tenantId: string, agentId: string) {
  const owned = await prisma.agentDefinition.findFirst({
    where: { id: agentId, tenantId },
    select: { id: true },
  });
  if (!owned) throw new Error("Agent not found.");
  // Runs outlive their definition — the audit trail must not vanish because
  // someone deleted the agent that produced it.
  await prisma.agentRun.updateMany({ where: { agentId }, data: { agentId: null } });
  await prisma.agentDefinition.delete({ where: { id: agentId } });
}

/**
 * Runs one named agent now.
 *
 * `userPresent` is false for scheduled runs and true when a person clicked
 * "run now" — the same distinction the autonomy gate uses everywhere else.
 */
export async function runNamedAgent(params: {
  tenantId: string;
  agentId: string;
  userPresent?: boolean;
  actor?: { userId: string; membershipId?: string | null };
}) {
  const { tenantId, agentId, userPresent = false, actor } = params;

  const agent = await prisma.agentDefinition.findFirst({
    where: { id: agentId, tenantId },
  });
  if (!agent) throw new Error("Agent not found.");

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      niche: true,
      memberships: { where: { role: "OWNER" }, take: 1, select: { id: true, userId: true } },
    },
  });
  const owner = tenant.memberships[0];
  if (!owner) throw new Error("This workspace has no owner to run as.");

  const result = await runAgent({
    ctx: {
      tenantId,
      role: "OWNER",
      userId: actor?.userId ?? owner.userId,
      membershipId: actor?.membershipId ?? owner.id,
      customerLabel: nicheConfig(tenant.niche).customerLabel,
    },
    input:
      `Do your job now. Report only what matters — if there is nothing worth raising, ` +
      `say exactly: NOTHING.`,
    brief: agent.brief,
    allowedTools: agent.toolNames,
    trigger: "AGENT",
    userPresent,
    agentId: agent.id,
  });

  await prisma.agentDefinition.update({
    where: { id: agent.id },
    data: { lastRunAt: new Date() },
  });

  return result;
}

/** Tool names an owner can pick from when configuring an agent. */
export function selectableToolNames(): string[] {
  return agentToolNames("OWNER");
}
