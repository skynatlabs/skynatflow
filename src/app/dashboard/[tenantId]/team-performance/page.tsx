// The Monday-morning "who's converting, who's closed what" report a
// manager would otherwise compile by hand — see
// src/lib/core/salesReporting.ts getTeamPerformance. Revenue won doubles
// as the commission rollup: it's exactly the figure a percentage-based
// commission would be calculated against.

import { getTeamPerformance } from "@/lib/core/salesReporting";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function TeamPerformancePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const performance = await getTeamPerformance(tenantId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Team performance</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Who&apos;s converting and what they&apos;ve won — attributed straight from the salesperson
        set on each quote, all-time. Revenue won is what a commission payout would be calculated
        against.
      </p>

      {performance.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          No quotes have a salesperson attributed yet.
        </div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {performance.map((p) => (
            <li key={p.membershipId} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{p.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {p.quotesAccepted} of {p.quotesSent} quotes won · {Math.round(p.conversionRate * 100)}% conversion
                </p>
              </div>
              <span className="text-sm font-semibold text-[var(--kb-text)]">{money(p.revenueWonCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
