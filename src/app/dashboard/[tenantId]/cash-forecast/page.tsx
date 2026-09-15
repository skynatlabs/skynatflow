import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { buildCashForecast } from "@/lib/core/cashForecast";
import { PageHeader } from "../PageHeader";

export const dynamic = "force-dynamic";

const LINES_PER_WEEK = 8;

function money(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}R${Math.abs(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function CashForecastPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ opening?: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const { opening } = await searchParams;
  const openingCents = Math.round((Number(opening) || 0) * 100);

  const forecast = await buildCashForecast({ tenantId, openingCents });
  const peak = Math.max(
    1,
    ...forecast.weeks.map((w) => Math.max(w.inflowCents, w.outflowCents))
  );

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        tenantId={tenantId}
        title="Cash forecast"
        crumbs={[{ label: "Cash forecast" }]}
      />

      <p className="-mt-2 mb-5 max-w-2xl text-sm text-[var(--kb-text-dim)]">
        The next thirteen weeks, built from invoices you&apos;re owed, recurring work and what you
        actually spend. Every line says where it came from.
      </p>

      {/* --------------------------------------------------------- headline */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="kb-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Expected in
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--kb-text)]">
            {money(forecast.totalInflowCents)}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Expected out
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--kb-text)]">
            {money(forecast.totalOutflowCents)}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Lowest point
          </p>
          <p
            className="mt-1 text-2xl font-bold"
            style={{
              color:
                forecast.lowestCents < 0
                  ? "var(--kb-status-danger-ink)"
                  : "var(--kb-text)",
            }}
          >
            {money(forecast.lowestCents)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--kb-text-dim)]">
            week {forecast.lowestWeek + 1}
          </p>
        </div>
      </div>

      {forecast.shortfallWeek !== null && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{
            background: "var(--kb-status-danger)",
            color: "var(--kb-status-danger-ink)",
          }}
        >
          <p className="text-sm font-semibold">
            Cash runs out in week {forecast.shortfallWeek + 1}
          </p>
          <p className="mt-1 text-xs">
            On current commitments. Chasing what&apos;s overdue, or moving a supplier payment, is
            what changes this.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- weeks */}
      <div className="kb-card mt-5 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--kb-panel-border)] text-left">
              {["Week", "In", "Out", "Net", "Balance", ""].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forecast.weeks.map((week) => (
              <tr key={week.index} className="border-b border-[var(--kb-panel-border)] align-top">
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="font-medium text-[var(--kb-text)]">W{week.index + 1}</span>
                  <span className="ml-2 text-[11px] text-[var(--kb-text-dim)]">
                    {week.weekStart.slice(5)}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-[var(--kb-text)]">
                  {week.inflowCents ? money(week.inflowCents) : "—"}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-[var(--kb-text-dim)]">
                  {week.outflowCents ? money(week.outflowCents) : "—"}
                </td>
                <td
                  className="px-3 py-2.5 tabular-nums font-medium"
                  style={{
                    color:
                      week.netCents < 0
                        ? "var(--kb-status-danger-ink)"
                        : "var(--kb-tint-mint-ink)",
                  }}
                >
                  {money(week.netCents)}
                </td>
                <td
                  className="px-3 py-2.5 tabular-nums font-semibold"
                  style={{
                    color:
                      week.closingCents < 0
                        ? "var(--kb-status-danger-ink)"
                        : "var(--kb-text)",
                  }}
                >
                  {money(week.closingCents)}
                </td>
                <td className="px-3 py-2.5" style={{ width: "30%" }}>
                  {/* A bar, not a chart library: two numbers per row, read at
                      a glance, and no dependency to keep current. */}
                  <span className="flex h-4 items-center gap-1">
                    <span
                      className="h-2 rounded-sm"
                      style={{
                        width: `${(week.inflowCents / peak) * 100}%`,
                        background: "var(--kb-tint-mint-ink)",
                        minWidth: week.inflowCents ? "2px" : 0,
                      }}
                    />
                    <span
                      className="h-2 rounded-sm"
                      style={{
                        width: `${(week.outflowCents / peak) * 100}%`,
                        background: "var(--kb-status-danger-ink)",
                        minWidth: week.outflowCents ? "2px" : 0,
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------- the detail */}
      <section className="mt-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Where the numbers come from</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {forecast.weeks
            .filter((w) => w.inflows.length > 0 || w.outflows.length > 0)
            .slice(0, 6)
            .map((week) => {
              // The largest lines explain a week; a business with two thousand
              // open invoices would otherwise send every one of them to the phone.
              const lines = [...week.inflows, ...week.outflows.map((o) => ({ ...o, out: true }))].sort(
                (a, b) => b.amountCents - a.amountCents
              );
              const shown = lines.slice(0, LINES_PER_WEEK);
              const rest = lines.slice(LINES_PER_WEEK);
              const restNet = rest.reduce((s, l) => s + ("out" in l ? -l.amountCents : l.amountCents), 0);
              return (
                <div key={week.index} className="kb-card p-3">
                  <p className="text-xs font-semibold text-[var(--kb-text)]">
                    Week {week.index + 1} · {week.weekStart.slice(5)}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {shown.map((line, i) => (
                      <li key={i} className="text-[11px] leading-snug">
                        <span className="font-medium text-[var(--kb-text)]">
                          {"out" in line ? "−" : "+"}
                          {money(line.amountCents)}
                        </span>{" "}
                        <span className="text-[var(--kb-text-dim)]">{line.label}</span>
                        <span className="block text-[10px] text-[var(--kb-text-dim)]">
                          {line.basis} · {line.confidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {rest.length > 0 && (
                    <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
                      and {rest.length.toLocaleString("en-US")} smaller line{rest.length === 1 ? "" : "s"}, {restNet < 0 ? "−" : "+"}
                      {money(Math.abs(restNet))} together
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      </section>

      {forecast.caveats.length > 0 && (
        <section className="kb-card mt-5 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
            What this forecast can&apos;t see
          </h2>
          <ul className="mt-2 space-y-1">
            {forecast.caveats.map((caveat) => (
              <li key={caveat} className="text-xs text-[var(--kb-text-dim)]">
                · {caveat}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
