// The heartbeat.
//
// This is the "not waiting for you to log in" part. On every tick each
// workspace's officers do their rounds and the coordinator builds the brief;
// then its agent looks at anything that actually happened since last time
// (events), any named agent whose schedule has come due, and — less often —
// the business as a whole in an open-ended review.
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
import { runEfficiency } from "@/lib/agent/officers/efficiency";
import { runCEO } from "@/lib/agent/officers/ceo";
import { runCOO } from "@/lib/agent/officers/coo";
import { runSales } from "@/lib/agent/officers/sales";
import { runLegal } from "@/lib/agent/officers/legal";
import { ninetyDayCheckIn } from "@/lib/agent/arrival";
import { realiseValue, recordPlatformCost } from "@/lib/core/valueLedger";
import { runCFO } from "@/lib/agent/officers/cfo";
import { expireStaleAgreements } from "@/lib/core/agreements";
import { raiseDueVisits } from "@/lib/core/maintenance";
import { wakeSnoozed } from "@/lib/core/conversations";
import { drainQueue } from "@/lib/core/offlineQueue";

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
  /** Findings the efficiency consultant wrote to the bus this tick. */
  efficiencyObserved: number;
  /** Findings the CEO wrote — zero on every tick but its monthly one. */
  ceoObserved: number;
  /** Findings from the COO, the sales consultant and the legal consultant. */
  cooObserved: number;
  salesObserved: number;
  legalObserved: number;
  /** Accepted findings whose outcome the data could now verify. */
  valueRealised: number;
  raised: number;
  skipped?: string;
  /** Model work that did not fit before the deadline and waits for the next tick. */
  deferred?: boolean;
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

const EMPTY: Omit<TickOutcome, "tenantId"> = {
  eventsHandled: 0,
  reviewed: false,
  agentsRun: 0,
  complianceRaised: 0,
  briefed: 0,
  cfoObserved: 0,
  efficiencyObserved: 0,
  ceoObserved: 0,
  valueRealised: 0,
  cooObserved: 0,
  salesObserved: 0,
  legalObserved: 0,
  raised: 0,
};

/**
 * The longest one model run may take on a tick. A provider that hangs must
 * not spend the time every other workspace's run was going to use.
 */
const MODEL_RUN_LIMIT_MS = 90_000;

export interface TickOptions {
  /**
   * Epoch milliseconds after which no model work starts. Work that does not
   * fit is left for the next tick — events stay queued rather than being
   * claimed and abandoned.
   */
  deadline?: number;
}

/**
 * One workspace's whole tick: its officers' rounds and brief, then anything
 * that needs the model.
 */
export async function tickTenant(tenantId: string, now = new Date(), opts: TickOptions = {}): Promise<TickOutcome> {
  const resolved = await ownerContextFor(tenantId);
  if (!resolved) return { tenantId, ...EMPTY, skipped: "no owner on this workspace" };
  if (!resolved.proactive) return { tenantId, ...EMPTY, skipped: "proactive mode is off" };

  const outcome: TickOutcome = { tenantId, ...EMPTY };
  await rounds(outcome, now);
  await modelWork(outcome, resolved.ctx, now, opts.deadline);
  return outcome;
}

/**
 * Everything on a tick that is arithmetic: deadlines, the six officers'
 * rounds, the value ledger and the brief. No model call is needed for any of
 * it (the CEO's optional phrasing has its own short limit), which is why it
 * runs first — it is what the owner reads in the morning, and it has to land
 * for every workspace on the day the provider is slow or out of credit.
 */
async function rounds(base: TickOutcome, now: Date): Promise<void> {
  const { tenantId } = base;

  // --- 0. Watch the deadlines ------------------------------------------------
  //
  // First, and without the model. A lapsing registration is arithmetic, not a
  // judgement call, and this arc has to keep working on the day the AI
  // provider is out of credit — which is precisely when nobody is watching
  // anything else either. See agent/complianceWatch.ts.
  try {
    const watch = await runComplianceWatch(tenantId, now);
    base.complianceRaised = watch.raised;
    base.raised += watch.raised > 0 ? 1 : 0;
  } catch (err) {
    // A failure here must not cost the workspace its event handling.
    console.error(`[agent:tick] ${tenantId} compliance watch failed:`, err);
  }

  // A proposal past its valid-until date is not still on the table, and a
  // list that says it is makes the pipeline figure a lie. Arithmetic, so it
  // sits here with the rest of the work that needs no model.
  try {
    await expireStaleAgreements(tenantId, now);
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} expiring agreements failed:`, err);
  }

  // Housekeeping that has to happen whether or not anybody logs in: a signed
  // maintenance agreement raises its next visit, a snoozed conversation comes
  // back when its moment arrives, and anything a phone captured with no
  // signal is applied. None of it needs a model, and all of it is wrong by
  // tomorrow if it waits for somebody to press something.
  for (const [what, run] of [
    ["maintenance visits", () => raiseDueVisits(tenantId, now)],
    ["waking snoozed conversations", () => wakeSnoozed(tenantId, now)],
    ["applying field captures", () => drainQueue({ tenantId })],
  ] as const) {
    try {
      await run();
    } catch (err) {
      console.error(`[agent:tick] ${tenantId} ${what} failed:`, err);
    }
  }

  // --- 1. The officers do their rounds --------------------------------------
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

  // The efficiency consultant carries the consolidation engine's findings —
  // a saving is arithmetic over slips, trips and policies, so no model here
  // either. The CEO speaks once a month; runCEO() keeps its own cadence and
  // returns quietly on every other day.
  try {
    const eff = await runEfficiency(tenantId);
    base.efficiencyObserved = eff.observed;
    if (eff.failed.length > 0) {
      console.error(`[agent:tick] ${tenantId} efficiency checks failed: ${eff.failed.join(", ")}`);
    }
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} efficiency failed:`, err);
  }
  for (const [key, run] of [
    ["cooObserved", () => runCOO(tenantId)],
    ["salesObserved", () => runSales(tenantId, now)],
    ["legalObserved", () => runLegal(tenantId, now)],
  ] as const) {
    try {
      const r = await run();
      base[key] = r.observed;
      if (r.failed.length > 0) console.error(`[agent:tick] ${tenantId} ${key} checks failed: ${r.failed.join(", ")}`);
    } catch (err) {
      console.error(`[agent:tick] ${tenantId} ${key} failed:`, err);
    }
  }
  try {
    const ceo = await runCEO(tenantId, { now });
    base.ceoObserved = ceo.observed;
    if (ceo.failed.length > 0) {
      console.error(`[agent:tick] ${tenantId} CEO checks failed: ${ceo.failed.join(", ")}`);
    }
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} CEO failed:`, err);
  }

  // The value ledger: what was accepted and can now be seen in the data, and
  // what the platform charged this month. Both idempotent, so a tick that
  // runs twice writes once.
  try {
    base.valueRealised = await realiseValue(tenantId, now);
    await recordPlatformCost(tenantId, now);
    // Day 30, 60 and 90: what the officers were worth, unprompted.
    await ninetyDayCheckIn(tenantId, now);
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} value ledger failed:`, err);
  }

  // --- 2. Let the coordinator decide what any of that was worth ------------
  //
  // Last among the rounds, deliberately: every arc above may have written
  // observations, and the coordinator should rank a whole tick's findings
  // against each other rather than the first one it sees winning by arriving
  // first. Model runs below write notifications, never observations, so
  // nothing they do is missing from this ranking.
  try {
    const brief = await buildBrief(tenantId, { now });
    base.briefed = brief.items.length;
    if (brief.headline) {
      await notify(tenantId, briefTitle(brief.items.length), brief.headline);
      base.raised += 1;
    }
  } catch (err) {
    console.error(`[agent:tick] ${tenantId} brief failed:`, err);
  }
}

type OwnerContext = NonNullable<Awaited<ReturnType<typeof ownerContextFor>>>["ctx"];

/**
 * The work that needs the model: reacting to events, named agents whose
 * schedule came due, and the occasional open-ended review. Each run is given
 * at most MODEL_RUN_LIMIT_MS, and none starts once the deadline is near.
 */
async function modelWork(base: TickOutcome, ctx: OwnerContext, now: Date, deadline?: number): Promise<void> {
  const { tenantId } = base;
  // Time for one more run, or none: a run started with seconds left is a run
  // cut off halfway, with its events already claimed.
  const signal = (): AbortSignal | null => {
    if (deadline === undefined) return AbortSignal.timeout(MODEL_RUN_LIMIT_MS);
    const left = deadline - Date.now();
    if (left < 20_000) return null;
    return AbortSignal.timeout(Math.min(MODEL_RUN_LIMIT_MS, left));
  };
  const defer = () => {
    base.deferred = true;
  };

  // --- 3. React to what actually happened -----------------------------------
  const eventSignal = signal();
  if (!eventSignal) return defer();
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
      abortSignal: eventSignal,
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
      base.raised += 1;
    }
    base.eventsHandled = events.length;
  }

  // --- 4. Run the named agents whose schedule came due ----------------------
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
    const agentSignal = signal();
    // Not run, so not marked as run: it is still due on the next tick.
    if (!agentSignal) return defer();

    try {
      // Scheduled means nobody is watching, so the gate holds anything
      // irreversible exactly as it does for the tick's own runs.
      const result = await runNamedAgent({ tenantId, agentId: agent.id, userPresent: false, abortSignal: agentSignal });
      base.agentsRun += 1;

      if (result.ok && !isNothing(result.reply)) {
        await notify(
          tenantId,
          titleFor(result.pendingActions.length, agent.name),
          result.reply,
          result.runId
        );
        base.raised += 1;
      }
    } catch (err) {
      // One misconfigured agent must not stop the others, or the review.
      console.error(`[agent:tick] ${tenantId} agent ${agent.id} failed:`, err);
    }
  }

  // --- 5. Review the business, occasionally ---------------------------------
  const lastReview = await prisma.agentRun.findFirst({
    where: { tenantId, trigger: "SCHEDULE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const due =
    !lastReview || now.getTime() - lastReview.createdAt.getTime() >= REVIEW_INTERVAL_MS;

  if (due) {
    const reviewSignal = signal();
    if (!reviewSignal) return defer();
    const result = await runAgent({
      ctx,
      trigger: "SCHEDULE",
      userPresent: false,
      now,
      abortSignal: reviewSignal,
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
      base.raised += 1;
    }
  }
}

/** How many workspaces do their rounds at once. */
const ROUNDS_CONCURRENCY = 4;

/**
 * Runs the tick across every workspace, isolating failures per tenant.
 *
 * In two passes. First every workspace's rounds and brief, a few at a time —
 * arithmetic, quick, and what every owner reads in the morning. Then the
 * model work, one workspace at a time, for as long as the deadline allows.
 * Done the other way round, one slow provider call per workspace would decide
 * how many businesses got their brief at all.
 */
export async function tickAllTenants(now = new Date(), opts: TickOptions = {}): Promise<TickOutcome[]> {
  const tenants = await prisma.tenant.findMany({
    where: { agentProactiveEnabled: true },
    select: { id: true },
  });

  const prepared: Array<{ outcome: TickOutcome; ctx: OwnerContext | null }> = [];
  let next = 0;
  const worker = async () => {
    while (next < tenants.length) {
      const t = tenants[next++];
      const entry: { outcome: TickOutcome; ctx: OwnerContext | null } = { outcome: { tenantId: t.id, ...EMPTY }, ctx: null };
      prepared.push(entry);
      try {
        const resolved = await ownerContextFor(t.id);
        if (!resolved) entry.outcome.skipped = "no owner on this workspace";
        else if (!resolved.proactive) entry.outcome.skipped = "proactive mode is off";
        else {
          entry.ctx = resolved.ctx;
          await rounds(entry.outcome, now);
        }
      } catch (err) {
        console.error(`[agent:tick] tenant ${t.id} failed:`, err);
        entry.ctx = null;
        entry.outcome.skipped = err instanceof Error ? err.message : "failed";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ROUNDS_CONCURRENCY, tenants.length) }, worker));

  for (const { outcome, ctx } of prepared) {
    if (!ctx) continue;
    try {
      await modelWork(outcome, ctx, now, opts.deadline);
    } catch (err) {
      console.error(`[agent:tick] tenant ${outcome.tenantId} model work failed:`, err);
    }
  }

  const order = new Map(tenants.map((t, i) => [t.id, i]));
  return prepared.map((p) => p.outcome).sort((a, b) => order.get(a.tenantId)! - order.get(b.tenantId)!);
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
