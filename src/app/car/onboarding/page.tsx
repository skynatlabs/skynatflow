// Moving in, measured.
//
// Ten minutes from signing up to the first quote sent is the target. This is
// the page that says whether it is being hit, and — more usefully — which
// step the ones who never finished were looking at when they stopped.

import { movingInMetrics } from "@/lib/onboarding/metrics";

export const dynamic = "force-dynamic";

function pill(value: string, tone: "good" | "flat" = "flat") {
  return (
    <span
      className="kb-pill text-[10px]"
      style={{
        background: tone === "good" ? "var(--kb-tint-mint)" : "var(--kb-panel)",
        color: tone === "good" ? "var(--kb-tint-mint-ink)" : "var(--kb-text-dim)",
      }}
    >
      {value}
    </span>
  );
}

export default async function OnboardingMetricsPage() {
  const m = await movingInMetrics(30);
  const number = (n: number | null, suffix = " min") => (n === null ? "—" : `${n}${suffix}`);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Moving in</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Businesses that signed up since {m.since.toLocaleDateString(undefined, { day: "numeric", month: "long" })}. The target is ten
        minutes from signing up to a quote out of the door.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Signed up", value: m.started.toLocaleString("en-US") },
          { label: "Finished setting up", value: `${m.finished} of ${m.started}` },
          { label: "Median to finish", value: number(m.medianMinutesToFinish) },
          { label: "Median to first quote", value: number(m.medianMinutesToFirstQuote) },
        ].map((tile) => (
          <div key={tile.label} className="kb-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">{tile.label}</p>
            <p className="mt-1 text-2xl font-bold text-[var(--kb-text)]">{tile.value}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--kb-text-dim)]">
        {m.withinTenMinutes} of {m.finished || 0} finished inside ten minutes.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Where the unfinished ones stopped</h2>
        {m.stalledAt.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">Nobody is stuck — everyone who started has finished.</p>
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {m.stalledAt.map((s) => (
              <li key={s.step} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-[var(--kb-text)]">{s.label}</span>
                <span className="text-sm font-semibold text-[var(--kb-text)]">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">The last twenty-five</h2>
        <div className="kb-card mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="px-4 py-2">Business</th>
                <th className="px-4 py-2">Signed up</th>
                <th className="px-4 py-2 text-right">To finish</th>
                <th className="px-4 py-2 text-right">To first quote</th>
                <th className="px-4 py-2">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kb-panel-border)]">
              {m.recent.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 font-medium text-[var(--kb-text)]">{t.name}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-[var(--kb-text-dim)]">
                    {t.createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{number(t.minutesToFinish)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{number(t.minutesToFirstQuote)}</td>
                  <td className="px-4 py-2">{t.step ? pill(`stopped at ${t.step}`) : pill("finished", "good")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
