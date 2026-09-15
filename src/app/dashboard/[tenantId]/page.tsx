// Owner dashboard home — a bird's-eye analytics view. Every widget here is
// a chart/graph/stat tile, no lists: quote pipeline, revenue trend, task
// status, inventory health, notifications, and customer growth all at a
// glance. Actionable lists (who to contact, overdue items) live on the
// Today/This Week pages — this page is purely "how's the business doing".

import { findStaleTransactions } from "@/lib/core/money";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";
import { getReorderSuggestions } from "@/lib/core/inventory";
import { prisma } from "@/lib/db";
import { DailyVoiceBriefing } from "./DailyVoiceBriefing";
import { VoiceAssistant } from "./VoiceAssistant";
import { AgentStatusStrip } from "./AgentStatusStrip";
import { ReadinessStrip } from "./Readiness";
import { getReadiness } from "@/lib/core/readiness";
import { QuickActions, type QuickAction } from "./QuickActions";
import {
  RevenueTrendChart,
  QuotePipelineChart,
  TaskStatusChart,
  InventoryHealthChart,
  NotificationsChart,
  CustomerGrowthChart,
} from "./HomeCharts";

export const dynamic = "force-dynamic";

function moneyCompact(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  });
}

// Sent and Accepted deliberately land on different hues (emerald vs.
// mango) — they used to both resolve to the same tint-ink color under the
// jewel skin, which made the pipeline donut read as almost entirely green.
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#c9cede",
  SENT: "var(--kb-accent-b)",
  ACCEPTED: "var(--kb-accent-mid)",
  PARTIALLY_PAID: "var(--kb-tint-yellow-ink)",
  PAID: "var(--kb-accent-a)",
  DECLINED: "var(--kb-tint-peach-ink)",
  OVERDUE: "#e2445c",
  CANCELLED: "#c9cede",
};

const TASK_COLORS: Record<string, string> = {
  TODO: "var(--kb-tint-blue-ink)",
  IN_PROGRESS: "var(--kb-tint-yellow-ink)",
  DONE: "var(--kb-tint-mint-ink)",
};

const NOTIF_COLORS: Record<string, string> = {
  HOT_LEAD: "#e2445c",
  IMPORTANT_EMAIL: "var(--kb-accent-b)",
  AUTO_FOLLOW_UP_SENT: "var(--kb-tint-mint-ink)",
  FOLLOW_UP_NEEDS_APPROVAL: "var(--kb-tint-yellow-ink)",
  PAYMENT_PROOF_RECEIVED: "var(--kb-accent-a)",
  GENERAL: "#c9cede",
};

function weekLabel(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  // Async Server Component: this runs once per request on the server, so a
  // per-request timestamp is intended, not impure client rendering.
  // eslint-disable-next-line react-hooks/purity
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000);
  // Async Server Component: this runs once per request on the server, so a
  // per-request timestamp is intended, not impure client rendering.
  // eslint-disable-next-line react-hooks/purity
  const sixMonthsAgo = new Date(Date.now() - 182 * 86_400_000);
  // Async Server Component: this runs once per request on the server, so a
  // per-request timestamp is intended, not impure client rendering.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  // Every read the page makes, started together — the dashboard is the first
  // screen after signing in, and nothing on it waits on anything else.
  const [
    tenant,
    stale,
    customerCount,
    openInvoices,
    quoteStatuses,
    thisWeek,
    revenueTx,
    tasks,
    items,
    notifications,
    newCustomers,
    readiness,
    lowStock,
    [runningRuns, awaitingRuns, lastRun, activeAgents, unsentQuotes, openTasks],
  ] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.transaction.aggregate({
      where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID"] } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.transaction.groupBy({ by: ["status"], where: { tenantId, type: "QUOTE" }, _count: true, orderBy: { status: "asc" } }),
    listThisWeekFollowUps(tenantId),
    prisma.transaction.findMany({
      where: { tenantId, type: { in: ["QUOTE", "INVOICE"] }, createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true, amountCents: true, type: true, status: true },
    }),
    prisma.task.findMany({ where: { tenantId }, select: { status: true } }),
    prisma.item.findMany({ where: { tenantId }, select: { stockQty: true, reorderPoint: true } }),
    prisma.notification.findMany({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
      select: { type: true },
    }),
    prisma.party.findMany({
      where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] }, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    // Read off real rows rather than a stored "onboarding step", so it ticks
    // itself off as ordinary work happens and can never disagree with reality.
    getReadiness(tenantId),
    getReorderSuggestions(tenantId),
    // Live agent state for the status strip and the shortcut counts.
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

  const staleTotalCents = stale.reduce((sum, t) => sum + t.amountCents, 0);
  const outstandingCents = openInvoices._sum.amountCents ?? 0;

  // Quote pipeline donut data
  const statusCounts = Object.fromEntries(quoteStatuses.map((q) => [q.status, q._count]));
  const pipelineData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replace("_", " "),
    value: count,
    color: STATUS_COLORS[status] ?? "#c9cede",
  }));

  // Revenue trend — bucket last 12 weeks
  const weeks: { start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    // Async Server Component: this runs once per request on the server, so a
    // per-request timestamp is intended, not impure client rendering.
    // eslint-disable-next-line react-hooks/purity
    const end = new Date(Date.now() - i * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    weeks.push({ start, end });
  }
  const revenueData = weeks.map(({ start, end }) => {
    const inWindow = revenueTx.filter((t) => t.createdAt >= start && t.createdAt < end);
    const quoted = inWindow.filter((t) => t.type === "QUOTE").reduce((s, t) => s + t.amountCents, 0) / 100;
    const revenue = inWindow
      .filter((t) => t.type === "INVOICE" && (t.status === "PAID" || t.status === "PARTIALLY_PAID"))
      .reduce((s, t) => s + t.amountCents, 0) / 100;
    return { label: weekLabel(end), quoted, revenue };
  });

  // Task status bars
  const taskCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const taskData = ["TODO", "IN_PROGRESS", "DONE"]
    .filter((s) => taskCounts[s])
    .map((s) => ({ name: s.replace("_", " "), value: taskCounts[s], color: TASK_COLORS[s] }));

  // Inventory health
  let healthy = 0, low = 0, outOfStock = 0;
  for (const it of items) {
    if (it.stockQty == null) continue;
    if (it.stockQty <= 0) outOfStock++;
    else if (it.reorderPoint != null && it.stockQty <= it.reorderPoint) low++;
    else healthy++;
  }
  // Notifications by type
  const notifCounts = notifications.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const notifData = Object.entries(notifCounts).map(([type, count]) => ({
    name: type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    value: count,
    color: NOTIF_COLORS[type] ?? "#c9cede",
  }));

  // Customer growth — bucket last 6 months
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    months.push({ start, end, label: start.toLocaleDateString(undefined, { month: "short" }) });
  }
  const growthData = months.map(({ start, end, label }) => ({
    label,
    count: newCustomers.filter((c) => c.createdAt >= start && c.createdAt < end).length,
  }));

  // Hero tile: total revenue collected across the 12-week window already
  // computed above for the trend chart, plus a simple first-half vs
  // second-half delta so the tile has a real "vs last month"-style signal
  // without another query.
  const revenueHeroTotalCents = Math.round(revenueData.reduce((sum, w) => sum + w.revenue, 0) * 100);
  const halfway = Math.floor(revenueData.length / 2);
  const firstHalfRevenue = revenueData.slice(0, halfway).reduce((sum, w) => sum + w.revenue, 0);
  const secondHalfRevenue = revenueData.slice(halfway).reduce((sum, w) => sum + w.revenue, 0);
  const revenueDeltaPercent =
    firstHalfRevenue > 0 ? Math.round(((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100) : null;

  const overdueCount = stale.length;
  const thisWeekNames = thisWeek.slice(0, 3).map((t) => t.party.name);
  const briefingParts = [`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${tenant.name}.`];
  if (overdueCount > 0) {
    briefingParts.push(`You have ${overdueCount} ${overdueCount === 1 ? "quote or invoice that has" : "quotes and invoices that have"} gone quiet and need a follow-up.`);
  }
  if (thisWeek.length > 0) {
    briefingParts.push(
      `This week you're scheduled to follow up with ${thisWeekNames.join(", ")}${thisWeek.length > 3 ? `, and ${thisWeek.length - 3} more` : ""}.`
    );
  }
  if (overdueCount === 0 && thisWeek.length === 0) {
    briefingParts.push("Nothing urgent is waiting on you right now.");
  }
  const briefingText = briefingParts.join(" ");

  const quickActions: QuickAction[] = [
    {
      href: `/dashboard/${tenantId}/quotes/new`,
      label: "New quote",
      hint: "Start a quote",
      tint: "peach",
      primary: true,
    },
    {
      href: `/dashboard/${tenantId}/cash-sale`,
      label: "Cash sale",
      hint: "Sell and settle now",
      tint: "mint",
    },
    {
      href: `/dashboard/${tenantId}/agent`,
      label: "Approvals",
      hint: awaitingRuns > 0 ? "The agent is waiting on you" : "Nothing waiting",
      count: awaitingRuns,
      tint: "yellow",
    },
    {
      href: `/dashboard/${tenantId}/overdue`,
      label: "Overdue",
      hint: "Money past its due date",
      count: overdueCount,
      tint: "violet",
    },
    {
      href: `/dashboard/${tenantId}/unsent-quotes`,
      label: "Unsent quotes",
      hint: "Drafts nobody has seen",
      count: unsentQuotes,
      tint: "blue",
    },
    {
      href: `/dashboard/${tenantId}/tasks`,
      label: "Tasks",
      hint: "Open on the board",
      count: openTasks,
      tint: "mint",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <DailyVoiceBriefing tenantId={tenantId} text={briefingText} />
      <VoiceAssistant tenantId={tenantId} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="kb-hero-greeting text-xl font-bold text-[var(--kb-text)] sm:text-2xl">
            Good to see you, {tenant.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Tell skynat.ai what you need, or look over the numbers below.
          </p>
        </div>
      </div>

      {/* The live layer: what the agent is doing, then the shortcuts that
          carry today's counts. Numbers come after — this page leads with what
          needs a decision, not with charts.

          The command box used to sit here too. It now lives in the dock at
          the foot of every page (see CommandBar), so keeping a second one
          here would be two inputs for the same agent, each with its own
          conversation thread — ask in one, follow up in the other, and the
          follow-up loses the context. */}
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


      {/* Bento hero — one tile earns the eye first (revenue collected),
          instead of every stat competing at the same visual weight. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_0.7fr_1fr]">
        <div
          className="kb-tile flex flex-col justify-between lg:row-span-2"
          // Tokenised rather than hardcoded navy so each skin can answer for
          // itself: Admina's grid is flat white, and an inline colour here
          // would win against its stylesheet.
          style={{ background: "var(--kb-hero-bg)", color: "var(--kb-hero-ink)" }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              Revenue collected — 12 weeks
            </p>
            <p className="mt-2 text-3xl font-extrabold">{moneyCompact(revenueHeroTotalCents)}</p>
            {revenueDeltaPercent !== null && (
              <p className="mt-1 text-xs opacity-80">
                {revenueDeltaPercent >= 0 ? "↑" : "↓"} {Math.abs(revenueDeltaPercent)}% vs previous 6 weeks
              </p>
            )}
          </div>
          <div className="mt-4 flex items-end gap-1.5" style={{ height: 60 }}>
            {(() => {
              const recent = revenueData.slice(-6);
              const max = Math.max(...recent.map((w) => w.revenue), 1);
              return recent.map((w, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t"
                  style={{ height: `${Math.max(6, (w.revenue / max) * 100)}%`, background: "var(--kb-accent-mid)" }}
                />
              ));
            })()}
          </div>
        </div>

        <div className="kb-tile">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Owed to you</p>
          <p className="mt-2 truncate text-xl font-extrabold" style={{ color: "var(--kb-accent-b)" }}>
            {moneyCompact(outstandingCents)}
          </p>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{openInvoices._count} open invoice{openInvoices._count === 1 ? "" : "s"}</p>
        </div>

        <div className="lg:row-span-2">
          <QuotePipelineChart data={pipelineData} />
        </div>

        <div className="kb-tile">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Customers</p>
          <p className="mt-2 text-2xl font-extrabold" style={{ color: "var(--kb-accent-a)" }}>
            {customerCount}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="kb-tile kb-tint-peach">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Gone quiet</p>
          <p className="mt-2 truncate text-xl font-extrabold">{moneyCompact(staleTotalCents)}</p>
          <p className="mt-1 text-xs opacity-70">{stale.length} need{stale.length === 1 ? "s" : ""} follow-up</p>
        </div>
        <div className="kb-tile kb-tint-yellow">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Low stock</p>
          <p className="mt-2 text-2xl font-extrabold">{lowStock.length}</p>
          <p className="mt-1 text-xs opacity-70">need reordering</p>
        </div>
      </div>

      <div className="mt-6">
        <RevenueTrendChart data={revenueData} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <InventoryHealthChart healthy={healthy} low={low} outOfStock={outOfStock} />
        <TaskStatusChart data={taskData} />
        <CustomerGrowthChart data={growthData} />
        <NotificationsChart data={notifData} />
      </div>
    </main>
  );
}
