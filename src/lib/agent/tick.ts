// The heartbeat.
//
// This is the "not waiting for you to log in" part. On every tick each
// workspace gets looked at by its agent: first anything that actually
// happened since last time (events), then any named agent whose schedule has
// come due, then — less often — an open-ended review of the business.
//
// Two things keep this from becoming noise, which is the failure mode that
// kills proactive features:
//   - only actionable event types enter the queue at all (agent/events.ts)
//   - an agent run with nothing worth saying produces no notification
//
// And one thing keeps it from becoming expensive: the review pass is rate
// limited per tenant, so a 15-minute tick doesn't mean 96 full agent runs a
// day per workspace.

import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { runAgent } from "@/lib/agent/runtime";
import { claimPendingEvents, EVENT_LABELS, type DomainEventType } from "@/lib/agent/events";
import { createNotification } from "@/lib/core/notifications2";
import { runNamedAgent } from "@/lib/agent/named";
import { isDue } from "@/lib/agent/schedule";
import { runComplianceWatch } from "@/lib/agent/complianceWatch";
import { buildBrief } from "@/lib/agent/chiefOfStaff";
import { runCFO } from "@/lib/agent/officers/cfo";

/** How long between open-ended reviews of one workspace. */
const REVIEW_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface TickOutcome {
  tenantId: string;
  eventsHandled: number;
  reviewed: boolean;
  /** Named agents whose schedule came due on this tick. */
  agentsRun: number;
  /** Obligations whose deadline state worsened and were raised this tick. */
  complianceRaised: number;
  /** Items the coordinator put in front of the owner. */
  briefed: number;
  /** Findings the CFO wrote to the bus this tick. */
  cfoObserved: number;
  raised: number;
  skipped?: string;
}

/**
 * The agent acts as the workspace owner: the owner is who it stands in for,
 * and whose permissions bound what it may propose.
 */
async function ownerContextFor(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      niche: true,
      agentProactiveEnabled: true,
      memberships: {
        where: { role: "OWNER" },
        take: 1,
        select: { id: true, userId: true, role: true },
      },
    },
  });
  if (!tenant) return null;
  const owner = tenant.memberships[0];
  if (!owner) return null;

  return {
    proactive: tenant.agentProactiveEnabled,
    ctx: {
      tenantId,
      role: "OWNER" as const,
      userId: owner.userId,
      membershipId: owner.id,
      customerLabel: nicheConfig(tenant.niche).customerLabel,
    },
  };
}

export async function tickTenant(tenantId: string, now = new Date()): Promise<TickOutcome> {
  const base: TickOutcome = {
    tenantId,
    eventsHandled: 0,
    reviewed: false,
    agentsRun: 0,
    complianceRaised: 0,
    briefed: 0,
    cfoObserved: 0,
    raised: 0,
  };

  const resolved = await ownerContextFor(tenantId);
  if (!resolved) return { ...base, skipped: "no owner on this workspace" };
  if (!resolved.proactive) return { ...base, skipped: "proactive mode is off" };

  const { ctx } = resolved;
  let raised = 0;

  // --- 0. Watch the deadlines ------------------------------------------------
  //
  // First, and without the model. A lapsing registration is arithmetic, not a
  // judgement call, and this arc has to keep working on the day the AI
  // provider is out of credit — which is precisely when nobody is watching
  // anything else either. See agent/complianceWatch.ts.
  try {
    const watch = await runComplianceWatch(tenantId, now);
    base.complianceRaised = watch.raised;
    raised += watch.raised > 0 ? 1 : 0;
  } catch (err) {
    // A failure here must not cost the workspace its event handling.
    console.error(`[agent:tick] ${tenantId} compliance watch failed:`, err);
  }

  // --- 1. React to what actually happened -----------------------------------
  const events = await claimPendingEvents(tenantId, 10);
  if (events.length > 0) {
    const summary = events
      .map((e) => {
        const label = EVENT_LABELS[e.type as DomainEventType] ?? e.type;
        return `- ${label} (${e.subjectType} ${e.subjectId})`;
      })
      .join("\n");

    const result = await runAgent({
      ctx,
      trigger: "EVENT",
      userPresent: false,
      now,
      input:
        `These things just happened in the business:\n${summary}\n\n` +
        `Look into each one properly — use your tools to find out what it is and ` +
        `who it involves before deciding anything.\n\n` +
        `Then, for anything that genuinely warrants acting on, GO AHEAD AND DO IT. ` +
        `Anything that moves money or contacts a customer will be intercepted and ` +
        `held for the owner to approve rather than executed, so attempting it is ` +
        `how you put a concrete, reviewable proposal in front of them — far more ` +
        `useful than describing what you might do. Reversible work (a note, a ` +
        `task, a reminder) may go through immediately.\n\n` +
        `Then summarise for the owner in plain language: what you found, what you ` +
        `did, and what is waiting on them. If nothing here needs attention, reply ` +
        `with exactly: NOTHING.`,
    });

    if (result.ok && !isNothing(result.reply)) {
      await notify(tenantId, titleFor(result.pendingActions.length, "Something needs you"), result.reply, result.runId);
      raised += 1;
    }
    base.eventsHandled = events.length;
  }

  // --- 2. Run the named agents whose schedule came due ----------------------
  //
  // The owner configured these deliberately — a collections agent at 9am on
  // weekdays is a standing instruction, and it outranks the generic review
  // below. Until this existed, AgentDefinition.schedule was stored, printed
  // back to the owner in the console, and never evaluated by anything.
  const defined = await prisma.agentDefinition.findMany({
    where: { tenantId, isActive: true, schedule: { not: null } },
    select: { id: true, name: true, schedule: true, lastRunAt: true },
  });

  for (const agent of defined) {
    if (!isDue({ expr: agent.schedule, lastRunAt: agent.lastRunAt, now })) continue;

    try {
      // Scheduled means nobody is watching, so the gate holds anything
      // irreversible exactly as it does for the tick's own runs.
      const result = await runNamedAgent({ tenantId, agentId: agent.id, userPresent: false });
      base.agentsRun += 1;

      if (result.ok && !isNothing(result.reply)) {
        await notify(
          tenantId,
          titleFor(result.pendingActions.length, agent.name),
          result.reply,
          result.runId
        );
        raised += 1;
      }
    } catch (err) {
      // One misconfigured agent must not stop the others, or the review.
      console.error(`[agent:tick] ${tenantId} agent ${agent.id} failed:`, err);
    }
  }

  // --- 3. Review the business, occasionally ---------------------------------
  const lastReview = await prisma.agentRun.findFirst({
    where: { tenantId, trigger: "SCHEDULE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const due =
    !lastReview || now.getTime() - lastReview.createdAt.getTime() >= REVIEW_INTERVAL_MS;

  if (due) {
    const result = await runAgent({
      ctx,
      trigger: "SCHEDULE",
      userPresent: false,
      now,
      input:
        `Review this business as it stands right now. Look at the headline numbers, ` +
        `what has gone quiet, what is overdue, and anything about stock or work in ` +
        `progress that looks wrong.\n\n` +
        `Raise at most the two most important things the owner should know about ` +
        `today — each with the number that makes it matter. Where there is an ` +
        `obvious next action, attempt it rather than only describing it: anything ` +
        `irreversible is held for their approval automatically, which turns your ` +
        `suggestion into something they can accept with one click.\n\n` +
        `Be selective. Two real things beat six trivial ones, and an owner who is ` +
        `interrupted for nothing stops reading. If nothing is worth interrupting ` +
        `them for, reply with exactly: NOTHING.`,
    });

    base.reviewed = true;
    if (result.ok && !isNothing(result.reply)) {
      await notify(
        tenantId,
        titleFor(result.pendingActions.length, "Your read on the business"),
        result.reply,
        result.runId
      );
      raised += 1;
    }
  }

  // --- 3.5 The officers do their rounds -------------------------------------
  //
  // Before the coordinator, so a whole tick's findings get ranked against
  // each other rather than the first one to arrive winning. The CFO needs no
  // model: every check it runs is arithmetic over the ledger, which is why it
  // keeps working on a day the AI provider does not.
  try {
    const cfo = await runCFO(tenantId);
    base.cfoObserved = cfo.observed;
    if (cfo.failed.length > 0) {
      console.error(`[agent:tick] ${tenantId} CFO checks failed: ${cfo.failed.join(", ")}`);
    }
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} CFO failed:`, err);
  }

  // --- 4. Let the coordinator decide what any of that was worth ------------
  //
  // Last, deliberately: every arc above may have written observations, and the
  // coordinator should rank a whole tick's findings against each other rather
  // than the first one it sees winning by arriving first.
  try {
    const brief = await buildBrief(tenantId, { now });
    base.briefed = brief.items.length;
    if (brief.headline) {
      await notify(tenantId, briefTitle(brief.items.length), brief.headline);
      raised += 1;
    }
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} brief failed:`, err);
  }

  return { ...base, raised };
}

/** Runs the tick across every workspace, isolating failures per tenant. */
export async function tickAllTenants(now = new Date()): Promise<TickOutcome[]> {
  const tenants = await prisma.tenant.findMany({
    where: { agentProactiveEnabled: true },
    select: { id: true },
  });

  const outcomes: TickOutcome[] = [];
  for (const t of tenants) {
    try {
      outcomes.push(await tickTenant(t.id, now));
    } catch (err) {
      console.error(`[agent:tick] tenant ${t.id} failed:`, err);
      outcomes.push({
        tenantId: t.id,
        eventsHandled: 0,
        reviewed: false,
        agentsRun: 0,
        complianceRaised: 0,
        briefed: 0,
        cfoObserved: 0,
        raised: 0,
        skipped: err instanceof Error ? err.message : "failed",
      });
    }
  }
  return outcomes;
}

// A run that found nothing must stay silent. Models are agreeable and will
// happily pad "NOTHING" into a paragraph, so check loosely rather than for
// an exact string.
function isNothing(reply: string): boolean {
  const normalised = reply.trim().toLowerCase().replace(/[.!]/g, "");
  return normalised === "nothing" || normalised.length === 0 || normalised.startsWith("nothing");
}

function briefTitle(count: number): string {
  return count === 1 ? "One thing worth your attention" : `${count} things worth your attention`;
}

// A title that says whether this is news or a decision. An owner scanning a
// notification list needs to know which ones are blocking on them.
function titleFor(pending: number, fallback: string): string {
  if (pending === 0) return fallback;
  return pending === 1
    ? "1 action is waiting for your approval"
    : `${pending} actions are waiting for your approval`;
}

async function notify(tenantId: string, title: string, body: string, runId?: string) {
  await createNotification({
    tenantId,
    type: "GENERAL",
    title,
    body: body.slice(0, 1500),
    // Deep-link to the run so approving is one click from the alert, rather
    // than a hunt through the console for which run this was about.
    linkHref: runId
      ? `/dashboard/${tenantId}/agent?run=${runId}`
      : `/dashboard/${tenantId}/agent`,
  });
}
