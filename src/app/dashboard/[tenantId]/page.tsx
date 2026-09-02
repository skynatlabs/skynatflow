// Owner dashboard home — a bird's-eye analytics view. Every widget here is
// a chart/graph/stat tile, no lists: quote pipeline, revenue trend, task
// status, inventory health, notifications, and customer growth all at a
// glance. Actionable lists (who to contact, overdue items) live on the
// Today/This Week pages — this page is purely "how's the business doing".

import Link from "next/link";
import { findStaleTransactions } from "@/lib/core/money";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";
import { getReorderSuggestions } from "@/lib/core/inventory";
import { prisma } from "@/lib/db";
import { DailyVoiceBriefing } from "./DailyVoiceBriefing";
import { VoiceAssistant } from "./VoiceAssistant";
import { PaCommandBox } from "./PaCommandBox";
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

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#c9cede",
  SENT: "var(--kb-accent-b)",
  ACCEPTED: "var(--kb-tint-mint-ink)",
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
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000);
  const sixMonthsAgo = new Date(Date.now() - 182 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [
    stale,
    customerCount,
    openInvoices,
    quotes,
    productCount,
    membershipCount,
    thisWeek,
    revenueTx,
    tasks,
    items,
    notifications,
    newCustomers,
  ] = await Promise.all([
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID"] } },
    }),
    prisma.transaction.findMany({ where: { tenantId, type: "QUOTE" } }),
    prisma.item.count({ where: { tenantId } }),
    prisma.membership.count({ where: { tenantId } }),
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
  ]);

  const checklist = [
    { label: "Add a product", done: productCount > 0, href: `/dashboard/${tenantId}/products/new` },
    { label: "Send a quote", done: quotes.length > 0, href: `/dashboard/${tenantId}/quotes/new` },
    { label: "Add a customer", done: customerCount > 0, href: `/dashboard/${tenantId}/customers` },
    { label: "Invite a teammate", done: membershipCount > 1, href: `/dashboard/${tenantId}/staff` },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;
  const showChecklist = checklistDone < checklist.length;

  const staleTotalCents = stale.reduce((sum, t) => sum + t.amountCents, 0);
  const outstandingCents = openInvoices.reduce((sum, t) => sum + t.amountCents, 0);

  // Quote pipeline donut data
  const statusCounts = quotes.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {});
  const pipelineData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replace("_", " "),
    value: count,
    color: STATUS_COLORS[status] ?? "#c9cede",
  }));

  // Revenue trend — bucket last 12 weeks
  const weeks: { start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
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
  const lowStock = await getReorderSuggestions(tenantId);

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

  return (
    <main className="mx-auto max-w-7xl p-8">
      <DailyVoiceBriefing tenantId={tenantId} text={briefingText} />
      <VoiceAssistant tenantId={tenantId} />
      <PaCommandBox tenantId={tenantId} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--kb-text)]">
            Good to see you, {tenant.name} 👋
          </h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            A bird&apos;s-eye view of your business, right now.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/${tenantId}/cash-sale`} className="kb-pill text-xs">
            Cash sale
          </Link>
          <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill kb-pill-primary">
            + New Quote
          </Link>
        </div>
      </div>

      {showChecklist && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {checklist.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="kb-tile kb-tint-violet flex flex-col justify-between transition-transform hover:-translate-y-0.5"
            >
              <span className="text-lg">{c.done ? "✓" : "○"}</span>
              <span className="mt-2 text-xs font-semibold">{c.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="kb-tile kb-tint-mint">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Owed to you</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(outstandingCents)}</p>
          <p className="mt-1 text-xs opacity-70">{openInvoices.length} open invoice{openInvoices.length === 1 ? "" : "s"}</p>
        </div>
        <div className="kb-tile kb-tint-peach">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Gone quiet</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(staleTotalCents)}</p>
          <p className="mt-1 text-xs opacity-70">{stale.length} need{stale.length === 1 ? "s" : ""} follow-up</p>
        </div>
        <div className="kb-tile kb-tint-blue">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Customers</p>
          <p className="mt-2 text-3xl font-extrabold">{customerCount}</p>
          <p className="mt-1 text-xs opacity-70">on file</p>
        </div>
        <div className="kb-tile kb-tint-yellow">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Low stock</p>
          <p className="mt-2 text-3xl font-extrabold">{lowStock.length}</p>
          <p className="mt-1 text-xs opacity-70">need reordering</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueTrendChart data={revenueData} />
        </div>
        <QuotePipelineChart data={pipelineData} />
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
