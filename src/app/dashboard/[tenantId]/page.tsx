// Home.
//
// Three things and nothing else: what the agent is doing and how to talk to
// it, a handful of shortcuts carrying today's counts, and then the numbers —
// as charts, for every aspect of the business this person is entitled to see
// and this trade actually has.
//
// It used to be one board for everybody: a retail shop's stock health on a
// courier's screen, and money on a driver's. So it was simultaneously too
// much and too little, which is what one dashboard for everybody always
// produces. The board is now built from the role and the trade (see
// core/kpis.ts); an owner gets every aspect, a rep gets selling, a driver
// gets the road.
//
// Lists of things to do deliberately live elsewhere — Today, This Week, the
// Brief. This page answers "how is it going", not "what now".

import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { getReadiness } from "@/lib/core/readiness";
import { kpiBoard } from "@/lib/core/kpis";
import { findStaleTransactions } from "@/lib/core/money";
import { DailyVoiceBriefing } from "./DailyVoiceBriefing";
import { VoiceAssistant } from "./VoiceAssistant";
import { AgentStatusStrip } from "./AgentStatusStrip";
import { ReadinessStrip } from "./Readiness";
import { QuickActions, type QuickAction } from "./QuickActions";
import { KpiBoardView } from "./KpiBoard";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";

export const dynamic = "force-dynamic";

export default async function TenantHomePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Everything the page needs, started together — this is the first screen
  // after signing in and nothing on it waits on anything else.
  const [board, readiness, stale, thisWeek, [runningRuns, awaitingRuns, lastRun, activeAgents, unsentQuotes, openTasks]] =
    await Promise.all([
      kpiBoard(tenantId, access.role, tenant.niche),
      getReadiness(tenantId),
      findStaleTransactions({ tenantId, staleAfterDays: 3 }),
      listThisWeekFollowUps(tenantId),
      Promise.all([
        prisma.agentRun.count({ where: { tenantId, status: "RUNNING" } }),
        prisma.agentRun.count({ where: { tenantId, status: "AWAITING_APPROVAL" } }),
        prisma.agentRun.findFirst({
          where: { tenantId, status: { in: ["DONE", "APPROVED", "AWAITING_APPROVAL"] } },
          orderBy: { createdAt: "desc" },
          select: { reply: true, createdAt: true },
        }),
        prisma.agentDefinition.count({ where: { tenantId, isActive: true } }),
        prisma.transaction.count({ where: { tenantId, type: "QUOTE", status: "DRAFT" } }),
        prisma.task.count({ where: { tenantId, status: { not: "DONE" } } }),
      ]),
    ]);

  const overdueCount = stale.length;
  const hour = new Date().getHours();
  const briefingParts = [`Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${tenant.name}.`];
  if (overdueCount > 0) {
    briefingParts.push(
      `You have ${overdueCount} ${overdueCount === 1 ? "quote or invoice that has" : "quotes and invoices that have"} gone quiet and need a follow-up.`
    );
  }
  if (thisWeek.length > 0) {
    const names = thisWeek.slice(0, 3).map((t) => t.party.name);
    briefingParts.push(
      `This week you're scheduled to follow up with ${names.join(", ")}${thisWeek.length > 3 ? `, and ${thisWeek.length - 3} more` : ""}.`
    );
  }
  if (overdueCount === 0 && thisWeek.length === 0) briefingParts.push("Nothing urgent is waiting on you right now.");

  // A few, not a wall: the ones that carry a number worth seeing at a glance.
  const quickActions: QuickAction[] = [
    { href: `/dashboard/${tenantId}/quotes/new`, label: "New quote", hint: "Start a quote", tint: "peach", primary: true },
    { href: `/dashboard/${tenantId}/cash-sale`, label: "Cash sale", hint: "Sell and settle now", tint: "mint" },
    {
      href: `/dashboard/${tenantId}/agent`,
      label: "Approvals",
      hint: awaitingRuns > 0 ? "The agent is waiting on you" : "Nothing waiting",
      count: awaitingRuns,
      tint: "yellow",
    },
    { href: `/dashboard/${tenantId}/overdue`, label: "Overdue", hint: "Money past its due date", count: overdueCount, tint: "violet" },
    { href: `/dashboard/${tenantId}/unsent-quotes`, label: "Unsent quotes", hint: "Drafts nobody has seen", count: unsentQuotes, tint: "blue" },
    { href: `/dashboard/${tenantId}/tasks`, label: "Tasks", hint: "Open on the board", count: openTasks, tint: "mint" },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <DailyVoiceBriefing tenantId={tenantId} text={briefingParts.join(" ")} />
      <VoiceAssistant tenantId={tenantId} />

      <div>
        <h1 className="kb-hero-greeting text-xl font-bold text-[var(--kb-text)] sm:text-2xl">
          Good to see you, {tenant.name}
        </h1>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          Tell skynat.ai what you need, or look over the numbers below.
        </p>
      </div>

      {/* The live layer. The command box itself lives in the dock at the foot
          of every page — a second one here would be two inputs for the same
          agent, each with its own thread, and a follow-up typed in the wrong
          one loses the conversation. */}
      <div className="mt-4 space-y-4">
        <ReadinessStrip readiness={readiness} />
        <AgentStatusStrip
          tenantId={tenantId}
          status={{
            running: runningRuns,
            awaitingApproval: awaitingRuns,
            lastRunAt: lastRun?.createdAt ?? null,
            lastRunSummary: lastRun?.reply ?? null,
            proactive: tenant.agentProactiveEnabled,
            activeAgents,
          }}
        />
        <QuickActions actions={quickActions} />
      </div>

      <div className="mt-8">
        <p className="mb-4 text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">{board.scope}</p>
        <KpiBoardView groups={board.groups} base={`/dashboard/${tenantId}`} />
      </div>
    </main>
  );
}
