import { prisma } from "@/lib/db";
import { getFuelAnomalies } from "@/lib/core/fuel";
import { logFuelAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function FuelPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [anomalies, memberships] = await Promise.all([
    getFuelAnomalies(tenantId),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Fuel logs</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Log fuel per driver — entries priced well outside that driver's own average get flagged.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Flagged entries</h2>
      {anomalies.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">Nothing unusual so far.</div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {anomalies.map((a) => (
            <li key={a.logId} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{a.driverName}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {money(Math.round(a.costPerLitre))}/L vs their avg {money(Math.round(a.driverAvgCostPerLitre))}/L
                </p>
              </div>
              <span className="kb-tile kb-tint-peach !py-1 !px-3 text-[11px] font-semibold">
                {a.deviationPercent > 0 ? "+" : ""}{a.deviationPercent.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Log fuel</h2>
      <form action={logFuelAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Driver</span>
          <select name="driverId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {memberships.map((m) => (
              <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Litres</span>
          <input name="litres" type="number" step="0.1" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Cost (ZAR)</span>
          <input name="costRand" type="number" step="0.01" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Odometer (km, optional)</span>
          <input name="odometerKm" type="number" className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">Log</button>
      </form>
    </main>
  );
}
