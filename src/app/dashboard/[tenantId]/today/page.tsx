// The Today planner — real appointment/job-card times where they exist
// (never invented), plus everything else worth attention today, ranked
// by urgency instead of a guessed time slot.

import Link from "next/link";
import { getTodayPlan } from "@/lib/core/dayPlan";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";

const KIND_LABEL: Record<string, string> = {
  appointment: "Appointments",
  job_card: "Job cards",
  quote: "Quotes",
  invoice: "Invoices",
};

const KIND_COLOR: Record<string, string> = {
  appointment: "var(--kb-tint-blue-ink)",
  job_card: "var(--kb-tint-violet-ink)",
  quote: "var(--kb-tint-yellow-ink)",
  invoice: "var(--kb-tint-peach-ink)",
};

function time(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const REASON_LABEL: Record<string, string> = {
  overdue_invoice: "Overdue",
  follow_up_due: "Follow-up due",
  stale: "Gone quiet",
  unscheduled_job_card: "Unscheduled job",
};

export default async function TodayPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const plan = await getTodayPlan(tenantId);

  const kindCounts = [...plan.timed, ...plan.untimed].reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});
  const barData = Object.entries(kindCounts).map(([kind, count]) => ({
    name: KIND_LABEL[kind] ?? kind,
    value: count,
    color: KIND_COLOR[kind] ?? "#94a3b8",
  }));

  function hrefFor(item: { kind: string; id: string }) {
    if (item.kind === "job_card") return `/dashboard/${tenantId}/job-cards`;
    if (item.kind === "invoice") return `/dashboard/${tenantId}/invoices/${item.id}`;
    if (item.kind === "quote") return `/dashboard/${tenantId}/quotes/${item.id}`;
    return `/dashboard/${tenantId}/appointments`;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Today</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Real times for what's actually booked, everything else ranked by what needs you most —
        nothing here has a made-up time slot.
      </p>

      {barData.length > 0 && (
        <div className="mt-6">
          <BreakdownBarChart title="Today's items by type" data={barData} />
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">Scheduled</h2>
        {plan.timed.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">Nothing booked for a specific time today.</p>
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {plan.timed.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link href={hrefFor(item)} className="flex items-center justify-between gap-4 p-4 hover:bg-black/[0.02]">
                  <div>
                    <p className="font-medium text-[var(--kb-text)]">{item.title}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">{item.partyName}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[var(--kb-text)]">{time(item.scheduledAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">To fit in today</h2>
        {plan.untimed.length === 0 ? (
          <div className="kb-card mt-2 p-8 text-center text-sm text-[var(--kb-text-dim)]">
            Nothing else needs your attention right now. 🎉
          </div>
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {plan.untimed.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link href={hrefFor(item)} className="flex items-center justify-between gap-4 p-4 hover:bg-black/[0.02]">
                  <div>
                    <p className="font-medium text-[var(--kb-text)]">{item.title}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">{item.partyName} · {item.detail}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold ${item.reason === "overdue_invoice" ? "text-[var(--kb-tint-peach-ink)]" : "text-[var(--kb-text-dim)]"}`}
                  >
                    {REASON_LABEL[item.reason]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
