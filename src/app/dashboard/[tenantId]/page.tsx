// Owner dashboard home — cash position first, per the strategic report's
// "one daily action, not a dashboard" principle (Section 12). Light, airy
// design pass: pastel stat tiles, a big colorful donut of the quote
// pipeline, pill buttons — built to feel playful, not like a chore.

import Link from "next/link";
import { findStaleTransactions } from "@/lib/core/money";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";
import { prisma } from "@/lib/db";
import { DailyVoiceBriefing } from "./DailyVoiceBriefing";
import { VoiceAssistant } from "./VoiceAssistant";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

// Rounded, no decimals — for the big stat-tile numbers specifically, where
// a shorter figure reads cleaner than exact cents and reliably fits the tile.
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

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const [stale, customerCount, openInvoices, quotes, productCount, membershipCount, thisWeek] = await Promise.all([
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID"] } },
    }),
    prisma.transaction.findMany({ where: { tenantId, type: "QUOTE" } }),
    prisma.item.count({ where: { tenantId } }),
    prisma.membership.count({ where: { tenantId } }),
    listThisWeekFollowUps(tenantId),
  ]);

  // Guided setup checklist — visible momentum in the trial's first week,
  // per the roadmap's "reduce time-to-value" framing. Hides itself once
  // everything's done so it doesn't linger as clutter for established accounts.
  const checklist = [
    { label: "Add your first product or service", done: productCount > 0, href: `/dashboard/${tenantId}/products/new` },
    { label: "Send your first quote", done: quotes.length > 0, href: `/dashboard/${tenantId}/quotes/new` },
    { label: "Get your first customer", done: customerCount > 0, href: `/dashboard/${tenantId}/customers` },
    { label: "Invite a teammate", done: membershipCount > 1, href: `/dashboard/${tenantId}/staff` },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;
  const showChecklist = checklistDone < checklist.length;

  // Trial value nudge — the switching-cost-made-visible moment (roadmap
  // item #49): once the account is a few days old and has real activity,
  // show what's actually been tracked instead of an abstract "don't leave" ask.
  const daysSinceSignup = Math.floor((Date.now() - tenant.createdAt.getTime()) / 86_400_000);
  const totalQuotedCents = quotes.reduce((sum, q) => sum + q.amountCents, 0);
  const hotLeadCount = quotes.filter((q) => q.openCount >= 2).length;
  const showTrialNudge = daysSinceSignup >= 6 && (quotes.length > 0 || customerCount > 0);

  const staleTotalCents = stale.reduce((sum, t) => sum + t.amountCents, 0);
  const outstandingCents = openInvoices.reduce((sum, t) => sum + t.amountCents, 0);

  // Donut segments from real quote-status counts — a conic-gradient built
  // server-side, no chart library needed for something this simple.
  const statusCounts = quotes.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {});
  const total = quotes.length || 1;
  let cursor = 0;
  const stops = Object.entries(statusCounts).map(([status, count]) => {
    const start = (cursor / total) * 360;
    cursor += count;
    const end = (cursor / total) * 360;
    return `${STATUS_COLORS[status] ?? "#c9cede"} ${start}deg ${end}deg`;
  });
  const donutStyle =
    quotes.length === 0
      ? { background: "var(--kb-panel-border)" }
      : { background: `conic-gradient(${stops.join(", ")})` };

  // The voice briefing script — same source data as the This Week board
  // and the "Needs your attention" list, so what's spoken always matches
  // what's on screen. Kept to plain sentences (no markdown/emoji) since
  // this is fed straight to speechSynthesis.
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
    <main className="mx-auto max-w-6xl p-8">
      <DailyVoiceBriefing tenantId={tenantId} text={briefingText} />
      <VoiceAssistant tenantId={tenantId} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--kb-text)]">
            Good to see you, {tenant.name} 👋
          </h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Here&apos;s what&apos;s happening across your business right now.
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

      {showTrialNudge && (
        <div className="kb-card mt-6 border border-[var(--kb-accent-a)]/30 bg-gradient-to-r from-[var(--kb-tint-violet)] to-[var(--kb-tint-blue)] p-5">
          <p className="text-sm font-semibold text-[var(--kb-text)]">
            {money(totalQuotedCents)} in quotes tracked, {customerCount} customer
            {customerCount === 1 ? "" : "s"} on file
            {hotLeadCount > 0 && `, ${hotLeadCount} hot lead${hotLeadCount === 1 ? "" : "s"} caught`}{" "}
            since you started.
          </p>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            That&apos;s everything the follow-up engine and hot-lead alerts have already caught for
            you — automatically.
          </p>
        </div>
      )}

      {showChecklist && (
        <div className="kb-card mt-6 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Get set up</h2>
            <span className="text-xs text-[var(--kb-text-dim)]">
              {checklistDone}/{checklist.length} done
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--kb-panel-border)]">
            <div
              className="h-full rounded-full bg-[var(--kb-accent-a)] transition-all"
              style={{ width: `${(checklistDone / checklist.length) * 100}%` }}
            />
          </div>
          <ul className="mt-4 space-y-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center justify-between text-sm">
                <span className={c.done ? "text-[var(--kb-text-dim)] line-through" : "text-[var(--kb-text)]"}>
                  {c.done ? "✓ " : ""}
                  {c.label}
                </span>
                {!c.done && (
                  <Link href={c.href} className="text-xs font-semibold text-[var(--kb-accent-a)] hover:underline">
                    Do it &rarr;
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="kb-tile kb-tint-mint">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
            Money owed to you
          </p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(outstandingCents)}</p>
          <p className="mt-1 text-xs opacity-70">
            {openInvoices.length} open invoice{openInvoices.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="kb-tile kb-tint-peach">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Gone quiet</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(staleTotalCents)}</p>
          <p className="mt-1 text-xs opacity-70">
            {stale.length} need{stale.length === 1 ? "s" : ""} a follow-up
          </p>
        </div>

        <div className="kb-tile kb-tint-blue">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Customers</p>
          <p className="mt-2 text-3xl font-extrabold">{customerCount}</p>
          <p className="mt-1 text-xs opacity-70">on file</p>
        </div>
      </div>

      <section className="kb-card mt-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">This week — who to contact</h2>
          <Link href={`/dashboard/${tenantId}/this-week`} className="text-xs font-semibold text-[var(--kb-accent-a)] hover:underline">
            View all &rarr;
          </Link>
        </div>
        {thisWeek.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--kb-text-dim)]">Nothing scheduled this week.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {thisWeek.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="text-[var(--kb-text)]">{t.party.name}</span>
                  {t.followUpNote && <span className="ml-2 text-xs text-[var(--kb-text-dim)]">— {t.followUpNote}</span>}
                </div>
                <span className="text-xs text-[var(--kb-text-dim)]">
                  {t.nextFollowUpAt?.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="kb-card p-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">Needs your attention</h2>
          {stale.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--kb-text-dim)]">
              Nothing overdue right now — the follow-up engine has it covered. 🎉
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--kb-panel-border)]">
              {stale.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }}
                    >
                      {t.type}
                    </span>
                    <span className="text-[var(--kb-text)]">{t.party.name}</span>
                  </div>
                  <span className="font-semibold text-[var(--kb-text)]">{money(t.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="kb-card flex flex-col items-center p-6">
          <h2 className="self-start text-sm font-semibold text-[var(--kb-text)]">
            Quote pipeline
          </h2>
          <div className="relative mt-4 h-[190px] w-[190px] rounded-full" style={donutStyle}>
            <div
              className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full"
              style={{ background: "var(--kb-panel)" }}
            >
              <span className="text-3xl font-extrabold text-[var(--kb-text)]">{quotes.length}</span>
              <span className="text-xs text-[var(--kb-text-dim)]">total quotes</span>
            </div>
          </div>
          <ul className="mt-5 w-full space-y-2">
            {Object.entries(statusCounts).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[var(--kb-text-dim)]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: STATUS_COLORS[status] ?? "#c9cede" }}
                  />
                  {status.replace("_", " ")}
                </span>
                <span className="font-semibold text-[var(--kb-text)]">{count}</span>
              </li>
            ))}
            {quotes.length === 0 && (
              <li className="text-xs text-[var(--kb-text-dim)]">No quotes yet.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
