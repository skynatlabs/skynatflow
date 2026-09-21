// What the database is actually doing.
//
// The audit could not say whether this application is fast, because nothing
// measured it. This is that measurement: every query is timed, the slow ones
// are all recorded and the rest sampled, and this reads them back as
// percentiles rather than averages — an average is what hides the one page in
// twenty that takes nine seconds, and that page is the whole reason somebody
// says a product feels slow.

import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { SAMPLE_ONE_IN, SLOW_QUERY_MS, operationTimings } from "@/lib/perf";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  await requireSuperAdmin();
  const rows = await operationTimings(prisma, 24);

  const slowest = rows.filter((r) => r.p95 >= SLOW_QUERY_MS);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Performance</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Database operations over the last 24 hours, slowest first by p95. Anything over{" "}
        {SLOW_QUERY_MS}ms is always recorded; everything else is sampled at one in {SAMPLE_ONE_IN},
        so the sample counts are a fraction of real traffic and the timings are not.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">
          Nothing recorded yet. Use the app and come back &mdash; at one in {SAMPLE_ONE_IN}, a quiet
          day may genuinely produce very little.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="kb-card p-4">
              <p className="text-xs text-[var(--kb-text-dim)]">Operations seen</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{rows.length}</p>
            </div>
            <div className="kb-card p-4">
              <p className="text-xs text-[var(--kb-text-dim)]">Over {SLOW_QUERY_MS}ms at p95</p>
              <p
                className="mt-1 text-xl font-semibold tabular-nums"
                style={{ color: slowest.length > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
              >
                {slowest.length}
              </p>
            </div>
            <div className="kb-card p-4">
              <p className="text-xs text-[var(--kb-text-dim)]">Worst single query</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
                {Math.max(...rows.map((r) => r.worst))}ms
              </p>
            </div>
          </div>

          <div className="kb-card mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="p-3">Operation</th>
                  <th className="p-3 text-right">p50</th>
                  <th className="p-3 text-right">p95</th>
                  <th className="p-3 text-right">Worst</th>
                  <th className="p-3 text-right">Samples</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.op} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 font-mono text-xs text-[var(--kb-text)]">{row.op}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.p50}ms</td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{
                        color: row.p95 >= SLOW_QUERY_MS ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
                      }}
                    >
                      {row.p95}ms
                    </td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.worst}ms</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                      {row.samples}
                      {row.slow > 0 && (
                        <span className="ml-1 text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>
                          ({row.slow} slow)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
