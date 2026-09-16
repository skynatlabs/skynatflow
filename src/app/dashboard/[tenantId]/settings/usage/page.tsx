// What this workspace has used.
//
// Here so that nothing is ever a surprise. The rule the page exists to make
// visible: a limit never stops work somebody is doing. What it stops is the
// things that run on their own, and it says so twice before it stops
// anything.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { usage, usageSummary } from "@/lib/core/quotas";

export const dynamic = "force-dynamic";

const WORD: Record<string, string> = {
  fine: "Fine",
  "getting-close": "Getting close",
  over: "Over",
};

export default async function UsagePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [rows, summary] = await Promise.all([usage(tenantId), usageSummary(tenantId)]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">This month</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{summary}</p>

      <ul className="mt-6 grid gap-3">
        {rows.map((row) => (
          <li key={row.meter} className="kb-card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-[var(--kb-text)]">{row.label}</span>
              <span className="text-xs text-[var(--kb-text-dim)]">{WORD[row.standing]}</span>
            </div>
            <p className="mt-1 text-sm tabular-nums text-[var(--kb-text)]">
              {row.used.toLocaleString()} <span className="text-[var(--kb-text-dim)]">of {row.allowance.toLocaleString()} {row.unit}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--kb-panel-border)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, row.percent)}%`,
                  background:
                    row.standing === "over"
                      ? "var(--kb-tint-rose-ink)"
                      : row.standing === "getting-close"
                        ? "var(--kb-tint-amber-ink)"
                        : "var(--kb-tint-mint-ink)",
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{row.note}</p>
          </li>
        ))}
      </ul>

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">How a limit behaves here</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          <li>Nothing you ask for is ever refused because of an allowance. Being told the workspace is out of budget halfway through an invoice on a Friday afternoon is worse than the cost of finishing it.</li>
          <li>What pauses is the work that runs on its own — the overnight sweeps, the proactive drafting, the bulk sends.</li>
          <li>The counts come from your actual records rather than a separate tally, because a tally and reality drift apart within a week.</li>
          <li>The file size is an estimate from the number of photographs stored, not a measurement.</li>
        </ul>
      </section>
    </main>
  );
}
