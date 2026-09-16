import { disputeHealth, listDisputes } from "@/lib/core/disputes";
import { resolveDisputeAction } from "./actions";
import { BreakdownDonut } from "@/components/dashboard/MiniCharts";

export const dynamic = "force-dynamic";

export default async function DisputesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [open, resolved, health] = await Promise.all([
    listDisputes(tenantId, { status: "OPEN" }),
    listDisputes(tenantId, { status: "RESOLVED", take: 20 }),
    disputeHealth(tenantId),
  ]);

  const donutData = [
    { name: "Open", value: health.open, color: "#e2445c" },
    { name: "Resolved", value: health.resolved, color: "var(--kb-tint-mint-ink)" },
  ];

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Customer reports</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        &quot;Something&apos;s not right&quot; flags raised from the customer portal on a quote or invoice.
      </p>

      {(health.open > 0 || health.resolved > 0) && (
        <>
          <div className="mt-6">
            <BreakdownDonut title="Reports by status" data={donutData} />
          </div>
          {/* The number that says whether this page is being used or just
              filled: how long the oldest person has been waiting. */}
          <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
            {health.open > 0
              ? `The oldest has been open ${health.oldestOpenDays} ${health.oldestOpenDays === 1 ? "day" : "days"}.`
              : "Nothing is waiting on you."}
            {health.averageDaysToSettle !== null &&
              ` On average these are settled in ${health.averageDaysToSettle} ${health.averageDaysToSettle === 1 ? "day" : "days"}.`}
          </p>
        </>
      )}

      <div className="mt-6 space-y-4">
        {open.map((d) => (
          <div key={d.id} className="kb-card p-6">
            <p className="text-sm font-medium text-[var(--kb-text)]">{d.partyName}</p>
            <p className="mt-1 text-sm text-[var(--kb-text)]">&ldquo;{d.message}&rdquo;</p>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              Raised {d.createdAt.toLocaleDateString()} · open {d.ageDays} {d.ageDays === 1 ? "day" : "days"}
            </p>
            <form action={resolveDisputeAction} className="mt-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="disputeId" value={d.id} />
              <input
                name="resolutionNote"
                placeholder="What did you do about it? (optional)"
                className="w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
              />
              <button type="submit" className="kb-pill kb-pill-primary mt-2 text-xs">
                Mark resolved
              </button>
            </form>
          </div>
        ))}
        {open.length === 0 && (
          <div className="kb-card p-6 text-sm text-[var(--kb-text-dim)]">
            Nothing open — nice.
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-[var(--kb-text)]">Resolved</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {resolved.map((d) => (
              <li key={d.id} className="p-4 text-sm">
                <p className="text-[var(--kb-text)]">
                  {d.partyName}: &ldquo;{d.message}&rdquo;
                </p>
                {d.resolutionNote && (
                  <p className="mt-1 text-xs text-[var(--kb-text-dim)]">&rarr; {d.resolutionNote}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
