// What the agent costs, and what it is allowed to cost.
//
// A business that cannot see what its agent costs cannot be asked to trust it
// with more, and a business that discovers the cost on an invoice will turn
// it off rather than tune it. So: recorded per run, visible in the workspace's
// own currency, and checked before the next run rather than after.
//
// The check is deliberately a soft stop for the scheduled work and never
// blocks a person who is sitting there asking a question. An owner typing
// "what do I owe" and being told the agent is out of budget is a worse
// outcome than a few cents.

import { prisma } from "@/lib/db";
import { ANTHROPIC_MODEL, GOOGLE_MODEL } from "@/lib/ai/model";

/**
 * Cost per million tokens, in US cents, at the rates these models publish.
 *
 * Approximate on purpose and stated as such wherever it is shown: the point
 * is that a business can see the shape of what it spends, not that this is an
 * invoice. A figure that pretends to be exact and is not would be worse.
 */
const RATES: Record<string, { inputCentsPerM: number; outputCentsPerM: number }> = {
  [ANTHROPIC_MODEL]: { inputCentsPerM: 300, outputCentsPerM: 1500 },
  [GOOGLE_MODEL]: { inputCentsPerM: 125, outputCentsPerM: 500 },
};

const FALLBACK = { inputCentsPerM: 300, outputCentsPerM: 1500 };

export function costOf(params: { model: string; inputTokens: number; outputTokens: number }): number {
  const rate = RATES[params.model] ?? FALLBACK;
  return (
    (params.inputTokens / 1_000_000) * rate.inputCentsPerM + (params.outputTokens / 1_000_000) * rate.outputCentsPerM
  );
}

export async function recordSpend(params: {
  tenantId: string;
  runId?: string | null;
  agentId?: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  at?: Date;
}) {
  return prisma.agentSpend.create({
    data: {
      tenantId: params.tenantId,
      runId: params.runId ?? null,
      agentId: params.agentId ?? null,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costCents: costOf(params),
      at: params.at ?? new Date(),
    },
  });
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface SpendThisMonth {
  costCents: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  capCents: number | null;
  /** Null when there is no cap. */
  percentOfCap: number | null;
  overBudget: boolean;
  summary: string;
}

export async function spendThisMonth(tenantId: string, now = new Date()): Promise<SpendThisMonth> {
  const [rows, tenant] = await Promise.all([
    prisma.agentSpend.findMany({
      where: { tenantId, at: { gte: monthStart(now) } },
      select: { costCents: true, inputTokens: true, outputTokens: true },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { agentMonthlyCapCents: true } }),
  ]);

  const costCents = rows.reduce((s, r) => s + r.costCents, 0);
  const cap = tenant.agentMonthlyCapCents;
  const percent = cap && cap > 0 ? Math.round((costCents / cap) * 100) : null;

  return {
    costCents: Math.round(costCents),
    runs: rows.length,
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    capCents: cap,
    percentOfCap: percent,
    overBudget: Boolean(cap && costCents >= cap),
    summary:
      rows.length === 0
        ? "The agent has not cost anything this month."
        : `${rows.length} runs this month, costing about ${(costCents / 100).toFixed(2)}` +
          (cap ? ` of a ${(cap / 100).toFixed(2)} cap — ${percent}%.` : "."),
  };
}

export async function setMonthlyCap(tenantId: string, capCents: number | null) {
  if (capCents !== null && capCents < 0) throw new Error("A cap cannot be negative.");
  return prisma.tenant.update({ where: { id: tenantId }, data: { agentMonthlyCapCents: capCents } });
}

export interface BudgetVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * May another run start?
 *
 * A person who is present is never stopped: being told the agent is out of
 * budget while you are typing a question to it is a worse outcome than a few
 * cents. The scheduled work stops, which is the spend that runs away.
 */
export async function mayRun(params: { tenantId: string; userPresent: boolean; now?: Date }): Promise<BudgetVerdict> {
  if (params.userPresent) return { allowed: true, reason: "Somebody is asking." };

  const spend = await spendThisMonth(params.tenantId, params.now);
  if (!spend.capCents) return { allowed: true, reason: "No cap is set on this workspace." };
  if (!spend.overBudget) {
    return { allowed: true, reason: `${spend.percentOfCap}% of this month's cap used.` };
  }
  return {
    allowed: false,
    reason: `This workspace has used its agent budget for the month. Background work is paused until the 1st, or until the cap is raised. Asking it something directly still works.`,
  };
}

/** Where the money went, by agent, this month. */
export async function spendByAgent(tenantId: string, now = new Date()) {
  const rows = await prisma.agentSpend.groupBy({
    by: ["agentId"],
    where: { tenantId, at: { gte: monthStart(now) } },
    _sum: { costCents: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });

  const agentIds = rows.map((r) => r.agentId).filter(Boolean) as string[];
  const agents = await prisma.agentDefinition.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } });
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));

  return rows
    .map((r) => ({
      agentId: r.agentId,
      name: r.agentId ? nameOf.get(r.agentId) ?? "A removed agent" : "The main assistant",
      runs: r._count._all,
      costCents: Math.round(r._sum.costCents ?? 0),
      tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
    }))
    .sort((a, b) => b.costCents - a.costCents);
}
