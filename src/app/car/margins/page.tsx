// What each workspace pays, and what it costs to serve.
//
// The instrument that says the price is wrong before the market does. It
// exists because of a specific failure mode: on a flat seat price with an
// agent behind it, the most engaged customers are the least profitable ones,
// and that is invisible until it is a pattern rather than a surprise.
//
// Sorted worst first, deliberately. A list of workspaces ordered by name
// buries the four that are losing money among the four hundred that are not.

import { margins } from "@/lib/core/billing";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { PLATFORM_CURRENCY } from "@/lib/brand";
import { formatMoney } from "@/lib/format/money";
import { platformGatewayStatus } from "@/lib/billing/collect";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  TRIALING: "Trial",
  ACTIVE: "Paying",
  PAST_DUE: "Past due",
  CANCELLED: "Cancelled",
};

export default async function MarginsPage() {
  await requireSuperAdmin();
  const rows = await margins();

  const money = (cents: number) => formatMoney(Math.round(cents), PLATFORM_CURRENCY);
  const revenue = rows.reduce((sum, r) => sum + r.revenueCents, 0);
  const cost = rows.reduce((sum, r) => sum + r.agentCostCents, 0);
  const losing = rows.filter((r) => r.revenueCents > 0 && r.grossCents < 0);
  const gateway = platformGatewayStatus();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Margins</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        This month, per workspace: what they pay against what their agent cost us to run. Agent
        spend is measured per run from real token counts, not estimated. Messaging and storage are
        real marginal costs too and are not counted here yet &mdash; this is the agent only, and
        the column says so.
      </p>

      {!gateway.configured && (
        <div
          className="kb-card mt-4 border-l-4 p-4"
          style={{ borderLeftColor: "var(--kb-status-danger-ink)" }}
        >
          <p className="text-sm font-medium text-[var(--kb-text)]">Nobody can be charged yet</p>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{gateway.note}</p>
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Subscription revenue</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{money(revenue)}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Agent cost</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{money(cost)}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Workspaces costing more than they pay</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{ color: losing.length > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
          >
            {losing.length}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">No workspaces yet.</p>
      ) : (
        <div className="kb-card mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="p-3">Workspace</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Seats</th>
                <th className="p-3 text-right">Pays</th>
                <th className="p-3 text-right">Agent cost</th>
                <th className="p-3 text-right">Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const bad = row.revenueCents > 0 && row.grossCents < 0;
                return (
                  <tr key={row.tenantId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 text-[var(--kb-text)]">{row.name}</td>
                    <td className="p-3 text-[var(--kb-text-dim)]">
                      {row.planKey}
                      <span className="ml-1 text-xs">&middot; {STATUS_LABEL[row.status] ?? row.status}</span>
                    </td>
                    <td className="p-3 text-[var(--kb-text-dim)]">
                      {row.seats.full}
                      {row.seats.field > 0 && <span className="text-xs"> +{row.seats.field} field</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">{money(row.revenueCents)}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                      {money(row.agentCostCents)}
                      {row.costRatio !== null && <span className="ml-1 text-xs">({row.costRatio}%)</span>}
                    </td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{ color: bad ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
                    >
                      {money(row.grossCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
