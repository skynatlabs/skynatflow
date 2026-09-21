// Approving what the agent held back.
//
// When the autonomy gate stops a tool call, the call's name and arguments are
// stored on the run rather than thrown away. Approving replays exactly those
// arguments — the model is not consulted a second time, so what a person sees
// on the approval screen is precisely what runs. Re-inferring the action from
// the prompt would mean approving one thing and executing another.

import { Prisma } from "@prisma/client";
import { capabilitiesOfBuiltIn, type Capability } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { buildAgentTools } from "@/lib/agent/tools";
import { nicheConfig } from "@/lib/niches/config";
import { recordAudit } from "@/lib/core/audit";

export interface PendingAction {
  tool: string;
  input: unknown;
  reason: string;
}

export interface ApprovalOutcome {
  ok: boolean;
  executed: { tool: string; output?: unknown; error?: string }[];
}

function parsePending(value: unknown): PendingAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is PendingAction =>
      typeof a === "object" && a !== null && typeof (a as { tool?: unknown }).tool === "string"
  );
}

/**
 * Builds the tool set an approval executes through.
 *
 * Rebuilt from the approver's own role, not the role of whoever (or whatever)
 * started the run — so approving cannot be used to execute something the
 * approver couldn't do themselves.
 */
async function toolsForApprover(
  tenantId: string,
  approver: {
    userId: string;
    role: string;
    /**
     * Resolved capabilities, when the caller has them.
     *
     * Optional because a caller holding only a built-in role name should not
     * have to look the list up — that is what the fallback below is for. A
     * workspace's own role has no built-in entry, so a caller in that
     * position MUST pass this; requireTenantAccess always does.
     */
    capabilities?: Capability[];
    membershipId?: string | null;
  }
) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, niche: true },
  });
  return buildAgentTools({
    tenantId,
    role: approver.role,
    capabilities: approver.capabilities ?? capabilitiesOfBuiltIn(approver.role),
    userId: approver.userId,
    membershipId: approver.membershipId,
    customerLabel: nicheConfig(tenant.niche).customerLabel,
      currency: tenant.currency,
  });
}

/** Executes one held action verbatim and records who let it through. */
async function executeApproved(params: {
  tenantId: string;
  runId: string;
  action: PendingAction;
  tools: Awaited<ReturnType<typeof toolsForApprover>>;
  approver: { userId: string };
}): Promise<{ tool: string; output?: unknown; error?: string }> {
  const { tenantId, runId, action, tools, approver } = params;

  const def = tools[action.tool] as
    | { execute?: (input: unknown, opts: unknown) => Promise<unknown> }
    | undefined;

  if (!def?.execute) {
    // The approver's role doesn't include this tool. Refusing here is the
    // point: approval is not an escalation path.
    return { tool: action.tool, error: "You don't have permission to run this action." };
  }

  try {
    const output = await def.execute(action.input, {});
    await recordAudit({
      tenantId,
      actorType: "user",
      actorId: approver.userId,
      capability: "task:manage",
      targetType: "AgentRun",
      targetId: runId,
      metadata: { approvedTool: action.tool, input: action.input },
    });
    return { tool: action.tool, output };
  } catch (err) {
    return { tool: action.tool, error: err instanceof Error ? err.message : "Failed" };
  }
}

/**
 * Runs every action a run was holding, as the approving user.
 */
export async function approveRun(params: {
  tenantId: string;
  runId: string;
  approver: {
    userId: string;
    role: string;
    /**
     * Resolved capabilities, when the caller has them.
     *
     * Optional because a caller holding only a built-in role name should not
     * have to look the list up — that is what the fallback below is for. A
     * workspace's own role has no built-in entry, so a caller in that
     * position MUST pass this; requireTenantAccess always does.
     */
    capabilities?: Capability[];
    membershipId?: string | null;
  };
}): Promise<ApprovalOutcome> {
  const { tenantId, runId, approver } = params;

  const run = await prisma.agentRun.findFirst({
    where: { id: runId, tenantId },
  });
  if (!run) throw new Error("Run not found.");
  if (run.status !== "AWAITING_APPROVAL") {
    throw new Error("This run isn't waiting for approval.");
  }

  const pending = parsePending(run.pendingActions);
  if (pending.length === 0) {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "APPROVED", resolvedAt: new Date(), resolvedBy: approver.userId },
    });
    return { ok: true, executed: [] };
  }

  const tools = await toolsForApprover(tenantId, approver);

  const executed: ApprovalOutcome["executed"] = [];
  for (const action of pending) {
    executed.push(await executeApproved({ tenantId, runId, action, tools, approver }));
  }

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: "APPROVED",
      resolvedAt: new Date(),
      resolvedBy: approver.userId,
      steps: JSON.parse(
        JSON.stringify([
          ...(Array.isArray(run.steps) ? run.steps : []),
          ...executed.map((e) => ({
            tool: e.tool,
            input: pending.find((p) => p.tool === e.tool)?.input,
            output: e.output ?? { error: e.error },
            isMutation: true,
            approvedBy: approver.userId,
          })),
        ])
      ),
      pendingActions: undefined,
    },
  });

  return { ok: executed.every((e) => !e.error), executed };
}

export async function rejectRun(params: {
  tenantId: string;
  runId: string;
  userId: string;
}): Promise<void> {
  const { tenantId, runId, userId } = params;
  const updated = await prisma.agentRun.updateMany({
    where: { id: runId, tenantId, status: "AWAITING_APPROVAL" },
    data: {
      status: "REJECTED",
      resolvedAt: new Date(),
      resolvedBy: userId,
      pendingActions: undefined,
    },
  });
  if (updated.count === 0) throw new Error("This run isn't waiting for approval.");
}


// --------------------------------------------------------- one at a time
//
// Approving a whole run is the common case, but it is the wrong shape when
// the agent proposes three things and the owner wants one of them. Before
// this, wanting the chaser but not the late fee meant taking both or neither
// — so the safe move was "dismiss", and a good proposal died with a bad one.

/** Removes one held action from a run, atomically, and hands it back. */
async function claimAction(
  tenantId: string,
  runId: string,
  index: number
): Promise<{ action: PendingAction; remaining: number }> {
  return prisma.$transaction(async (tx) => {
    // Two managers can be looking at the same queue. Without the row lock
    // both read the same array, both splice index 0, and the customer gets
    // charged twice — read-committed does not save us here.
    await tx.$queryRaw`SELECT id FROM agent_runs WHERE id = ${runId} AND "tenantId" = ${tenantId} FOR UPDATE`;

    const run = await tx.agentRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new Error("Run not found.");
    if (run.status !== "AWAITING_APPROVAL") {
      throw new Error("This run isn't waiting for approval.");
    }

    const pending = parsePending(run.pendingActions);
    const action = pending[index];
    if (!action) throw new Error("That action has already been dealt with.");

    const remaining = pending.filter((_, i) => i !== index);
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        pendingActions: remaining.length
          ? JSON.parse(JSON.stringify(remaining))
          : Prisma.DbNull,
      },
    });

    return { action, remaining: remaining.length };
  });
}

/**
 * Closes a run once nothing is left waiting.
 *
 * APPROVED when at least one action actually ran, REJECTED when every one was
 * turned down — so the history says which it was rather than flattening both
 * into "resolved".
 */
async function finaliseIfEmpty(runId: string, userId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (parsePending(run.pendingActions).length > 0) return;

  const steps = Array.isArray(run.steps) ? (run.steps as Record<string, unknown>[]) : [];
  const anyApproved = steps.some((s) => s && typeof s === "object" && "approvedBy" in s);

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: anyApproved ? "APPROVED" : "REJECTED",
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
  });
}

async function appendStep(runId: string, step: Record<string, unknown>) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { steps: true } });
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  await prisma.agentRun.update({
    where: { id: runId },
    data: { steps: JSON.parse(JSON.stringify([...steps, step])) },
  });
}

/** Approves and runs a single held action, leaving the rest waiting. */
export async function approveAction(params: {
  tenantId: string;
  runId: string;
  index: number;
  approver: {
    userId: string;
    role: string;
    /**
     * Resolved capabilities, when the caller has them.
     *
     * Optional because a caller holding only a built-in role name should not
     * have to look the list up — that is what the fallback below is for. A
     * workspace's own role has no built-in entry, so a caller in that
     * position MUST pass this; requireTenantAccess always does.
     */
    capabilities?: Capability[];
    membershipId?: string | null;
  };
}): Promise<{ ok: boolean; tool: string; error?: string }> {
  const { tenantId, runId, index, approver } = params;

  // Claim first, execute after. If the process dies in between, the action is
  // lost rather than run twice — for something that moves money that is the
  // right direction to fail in.
  const { action } = await claimAction(tenantId, runId, index);

  const tools = await toolsForApprover(tenantId, approver);
  const result = await executeApproved({ tenantId, runId, action, tools, approver });

  await appendStep(runId, {
    tool: result.tool,
    input: action.input,
    output: result.output ?? { error: result.error },
    isMutation: true,
    approvedBy: approver.userId,
  });
  await finaliseIfEmpty(runId, approver.userId);

  return { ok: !result.error, tool: result.tool, error: result.error };
}

/** Turns down a single held action without touching the others. */
export async function rejectAction(params: {
  tenantId: string;
  runId: string;
  index: number;
  userId: string;
}): Promise<{ ok: true; tool: string }> {
  const { tenantId, runId, index, userId } = params;
  const { action } = await claimAction(tenantId, runId, index);

  // Recorded, not erased: "the agent wanted to do this and a person said no"
  // is information, and without it the run log reads as though it never
  // proposed anything.
  await appendStep(runId, {
    tool: action.tool,
    input: action.input,
    output: { declined: true },
    isMutation: false,
    blockedReason: "Declined by a person.",
    declinedBy: userId,
  });
  await finaliseIfEmpty(runId, userId);

  return { ok: true, tool: action.tool };
}

/** Runs holding something, newest first — the approval inbox. */
export async function listPendingRuns(tenantId: string, take = 20) {
  return prisma.agentRun.findMany({
    where: { tenantId, status: "AWAITING_APPROVAL" },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listRecentRuns(tenantId: string, take = 30) {
  return prisma.agentRun.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
