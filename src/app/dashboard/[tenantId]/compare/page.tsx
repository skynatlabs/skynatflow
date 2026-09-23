// Where this business sits.
//
// Two comparisons on one page, and they have different rules on purpose.
//
// The operating figures — margin, how long invoices take, how many quotes
// turn into work — and the prices paid to suppliers both need the workspace
// to have opted in, both are reported as distributions rather than averages,
// and neither reports anything at all below five contributing businesses.
//
// The third block needs none of that, because every number in it already
// belongs to the business asking: the same product bought from two suppliers
// at two prices. It is usually the most actionable thing here and it
// involves nobody else at all.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { compare } from "@/lib/core/benchmarks";
import { priceBenchmarks, supplierSpread, PRICE_COHORT_FLOOR } from "@/lib/core/priceBenchmarks";
import { setComparisonAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);

  const [operating, prices, spread, currency] = await Promise.all([
    compare(tenantId),
    priceBenchmarks(tenantId, {}),
    supplierSpread(tenantId, {}),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const show = (value: number | null, unit: string) =>
    value === null
      ? "—"
      : unit === "money"
        ? money(value)
        : unit === "days"
          ? `${Math.round(value)} days`
          : `${Math.round(value * 10) / 10}%`;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">How you compare</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Against businesses in the same trade, anonymously. Nothing is reported unless at least{" "}
        {PRICE_COHORT_FLOOR} businesses stand behind it, and nothing identifying anybody is ever
        shown &mdash; a comparison drawn on three businesses is one competitor reading another.
      </p>

      <form action={setComparisonAction} className="kb-card mt-6 p-5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="optedIn"
            defaultChecked={operating.optedIn}
            disabled={access.role !== "OWNER"}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-[var(--kb-text)]">
              Compare this business with others
            </span>
            <span className="mt-1 block text-[var(--kb-text-dim)]">
              Adds this workspace&apos;s figures to the anonymous pool for its trade, and shows you
              where you sit in it. Turning it off stops both, immediately.
            </span>
          </span>
        </label>
        {access.role === "OWNER" ? (
          <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">
            Save
          </button>
        ) : (
          <p className="mt-3 text-xs text-[var(--kb-text-dim)]">Only the owner can change this.</p>
        )}
      </form>

      {!operating.optedIn ? (
        <div className="kb-card mt-6 p-5 text-sm text-[var(--kb-text-dim)]">{operating.note}</div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">How the business runs</h2>
            {operating.comparisons.length === 0 ? (
              <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
                {operating.note}
              </div>
            ) : (
              <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
                {operating.comparisons.map((c) => (
                  <li key={c.metric} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-[var(--kb-text)]">{c.label}</p>
                      <p className="tabular-nums text-[var(--kb-text)]">
                        {show(c.yours, c.unit)}
                        <span className="ml-2 text-xs text-[var(--kb-text-dim)]">
                          middle {show(c.median, c.unit)}
                        </span>
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
                      {c.standing ? `You are ${c.standing}. ` : ""}
                      {c.note}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">What you pay for things</h2>
            <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
              From what comparable businesses were actually charged, not from an advertised price.
              Nobody is scraped and no supplier is named.
            </p>
            {prices.rows.length === 0 ? (
              <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
                {prices.summary}
              </div>
            ) : (
              <>
                {prices.totalCouldSaveCentsPerYear > 0 && (
                  <div className="kb-card mt-3 p-4">
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      Buying at the middle instead, over a year
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
                      {money(prices.totalCouldSaveCentsPerYear)}
                    </p>
                  </div>
                )}
                <div className="kb-card mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                        <th className="p-3">Line</th>
                        <th className="p-3 text-right">You pay</th>
                        <th className="p-3 text-right">Others, middle</th>
                        <th className="p-3 text-right">Difference</th>
                        <th className="p-3 text-right">A year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.rows.slice(0, 25).map((row) => (
                        <tr key={row.itemId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                          <td className="p-3 text-[var(--kb-text)]">
                            {row.name}
                            <span className="ml-2 text-xs text-[var(--kb-text-dim)]">
                              {row.cohort} businesses
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">
                            {money(row.yoursCents)}
                          </td>
                          <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                            {money(row.medianCents)}
                          </td>
                          <td
                            className="p-3 text-right tabular-nums"
                            style={{
                              color:
                                row.differenceCents > 0
                                  ? "var(--kb-status-danger-ink)"
                                  : "var(--kb-status-ok-ink, var(--kb-text))",
                            }}
                          >
                            {row.differencePercent > 0 ? "+" : ""}
                            {row.differencePercent}%
                          </td>
                          <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">
                            {row.couldSaveCentsPerYear > 0 ? money(row.couldSaveCentsPerYear) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {prices.notEnoughData.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
                    Not enough businesses buying the same thing to compare:{" "}
                    {prices.notEnoughData.slice(0, 8).join(", ")}
                    {prices.notEnoughData.length > 8 && ` and ${prices.notEnoughData.length - 8} more`}.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">
          The same thing, from different suppliers
        </h2>
        <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
          Your own purchase records only. Nobody else is involved, so this works whether or not
          comparison is switched on &mdash; and it is usually the saving available this afternoon.
        </p>
        {spread.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing here yet. This needs the same product bought from at least two suppliers.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {spread.slice(0, 20).map((row) => (
              <li key={row.itemName} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-[var(--kb-text)]">{row.itemName}</p>
                  <p className="text-sm tabular-nums" style={{ color: "var(--kb-status-warn-ink)" }}>
                    {row.spreadPercent}% apart
                  </p>
                </div>
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  {row.suppliers
                    .map((s) => `${s.supplierName} ${money(s.lastPaidCents)}`)
                    .join("  ·  ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
