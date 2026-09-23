// What happened after the warehouse.
//
// Penetration is counted against outlets that actually bought something in
// the window, not every shop on the map. A shop that has not ordered at all
// is a coverage problem and belongs on the field sales page; counting it
// here would make every line look weak for a reason that has nothing to do
// with the line.
//
// The two working lists — gaps and dropped — are the point of the page. A
// distributor does not need a chart; it needs the twelve shops a rep should
// argue with tomorrow morning.

import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import {
  penetration,
  channelMix,
  mustStockGaps,
  droppedLines,
} from "@/lib/core/distribution";

export const dynamic = "force-dynamic";

export default async function DistributionPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [pen, mix, gaps, dropped, currency] = await Promise.all([
    penetration(tenantId, 90),
    channelMix(tenantId, 90),
    mustStockGaps(tenantId, {}),
    droppedLines(tenantId, {}),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Distribution</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Ninety days of what actually moved into shops, per line. Penetration is measured against
        the outlets that bought <em>anything</em> in the window &mdash; a shop that ordered
        nothing is a coverage problem, and it lives on{" "}
        <Link href={`/dashboard/${tenantId}/field-sales`} className="underline">
          field sales
        </Link>
        .
      </p>

      {pen.rows.length === 0 ? (
        <div className="kb-card mt-6 p-5 text-sm text-[var(--kb-text-dim)]">{pen.summary}</div>
      ) : (
        <>
          <div className="kb-card mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="p-3">Line</th>
                  <th className="p-3 text-right">Shops taking it</th>
                  <th className="p-3 text-right">Penetration</th>
                  <th className="p-3 text-right">Units</th>
                  <th className="p-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {pen.rows.slice(0, 40).map((row) => (
                  <tr key={row.itemId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 text-[var(--kb-text)]">{row.name}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                      {row.outletsBuying} of {row.outletsPossible}
                    </td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{
                        color:
                          row.penetrationPercent < 30
                            ? "var(--kb-status-warn-ink)"
                            : "var(--kb-text)",
                      }}
                    >
                      {row.penetrationPercent}%
                    </td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                      {row.unitsMoved}
                    </td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">
                      {money(row.valueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {mix.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-[var(--kb-text)]">Where the volume goes</h2>
              <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
                {mix.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="font-medium text-[var(--kb-text)]">{c.channel}</p>
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        {c.outlets} shop{c.outlets === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="tabular-nums text-[var(--kb-text)]">
                      {money(c.valueCents)}{" "}
                      <span className="text-xs text-[var(--kb-text-dim)]">{c.sharePercent}%</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Shops missing a line</h2>
        <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
          Not a must-stock list somebody typed two years ago &mdash; lines that most comparable
          shops in the same channel actually carry, and this one does not.
        </p>
        {gaps.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing stands out. This needs at least three shops in a channel before it will
            compare them.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {gaps.slice(0, 20).map((gap) => (
              <li key={gap.partyId} className="px-5 py-3">
                <p className="font-medium text-[var(--kb-text)]">
                  {gap.outletName}
                  {gap.channel && (
                    <span className="ml-2 text-xs text-[var(--kb-text-dim)]">{gap.channel}</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  {gap.missing
                    .map((m) => `${m.name} (${m.carriedByPercent}% of peers)`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Listings that have gone</h2>
        <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
          A shop that took something on a rhythm for months and stopped. It reads as nothing in a
          revenue report, because the shop is still buying &mdash; just not that.
        </p>
        {dropped.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing has been dropped that had an established rhythm.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {dropped.slice(0, 20).map((d) => (
              <li
                key={`${d.partyId}-${d.itemId}`}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              >
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{d.outletName}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {d.itemName} &middot; used to take it every {d.typicalGapDays} days
                  </p>
                </div>
                <p className="text-sm tabular-nums" style={{ color: "var(--kb-status-warn-ink)" }}>
                  {d.daysSince} days
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
