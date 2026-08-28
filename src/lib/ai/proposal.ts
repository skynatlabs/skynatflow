// AI-generated proposal content — the LLM only ever writes text into
// fixed fields (introText, scopeOfWork, systemInfo, performanceExpectancy,
// projectTimeline). It never touches the PDF design/layout, which stays
// fixed code in DocumentTemplate.tsx — this is deliberate for both cost
// (no design tokens burned per call) and consistency (every proposal
// looks like a flow proposal, not whatever the model felt like that day).
//
// Needs ANTHROPIC_API_KEY to actually call the model; without it this
// throws clearly, same as followUp.ts.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { prisma } from "@/lib/db";

const ProposalContentSchema = z.object({
  introText: z.string().describe("A short, warm 2-3 sentence introduction to the proposal."),
  scopeOfWork: z.string().describe("A clear paragraph describing exactly what work/product is covered."),
  systemInfo: z.string().describe("Technical/system details relevant to what's being quoted, based on the line items."),
  performanceExpectancy: z.string().describe("What the customer should realistically expect in terms of performance/output/results."),
  projectTimeline: z.string().describe("A realistic, brief timeline outline from start to completion, as plain text (e.g. 'Week 1: ..., Week 2: ...')."),
});

export type GeneratedProposalContent = z.infer<typeof ProposalContentSchema>;

const MONTHLY_LIMIT_FREE = 5;

// Simple monthly counter — resets on read once the month has rolled over,
// no cron job needed. Returns the tenant's current usage + limit so the
// caller can show it before/after generating.
export async function getProposalUsage(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const now = new Date();
  const resetDue =
    now.getUTCFullYear() !== tenant.aiProposalGenerationsResetAt.getUTCFullYear() ||
    now.getUTCMonth() !== tenant.aiProposalGenerationsResetAt.getUTCMonth();

  if (resetDue) {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { aiProposalGenerationsUsed: 0, aiProposalGenerationsResetAt: now },
    });
    return { used: 0, limit: MONTHLY_LIMIT_FREE, remaining: MONTHLY_LIMIT_FREE, tenant: updated };
  }

  return {
    used: tenant.aiProposalGenerationsUsed,
    limit: MONTHLY_LIMIT_FREE,
    remaining: Math.max(0, MONTHLY_LIMIT_FREE - tenant.aiProposalGenerationsUsed),
    tenant,
  };
}

export async function generateProposalContent(params: {
  tenantId: string;
  tenantName: string;
  customerName: string;
  projectLocation: string;
  lines: { name: string; quantity: number }[];
}): Promise<GeneratedProposalContent> {
  const usage = await getProposalUsage(params.tenantId);
  if (usage.remaining <= 0) {
    throw new Error(
      `You've used all ${usage.limit} AI-generated proposals this month. Upgrade for more, or write this one manually.`
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("AI proposal generation needs ANTHROPIC_API_KEY configured — write the proposal manually for now.");
  }

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-5"),
    schema: ProposalContentSchema,
    system:
      "You write concise, professional project proposal content for a small business quoting a customer. " +
      "Base everything on the actual line items given — never invent products/services not listed. " +
      "No filler, no generic marketing language, plain and specific.",
    prompt:
      `Business: ${params.tenantName}\n` +
      `Customer: ${params.customerName}\n` +
      `Project location: ${params.projectLocation}\n` +
      `Line items:\n${params.lines.map((l) => `- ${l.quantity}x ${l.name}`).join("\n")}\n\n` +
      `Write the proposal content.`,
  });

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: { aiProposalGenerationsUsed: { increment: 1 } },
  });

  return object;
}
