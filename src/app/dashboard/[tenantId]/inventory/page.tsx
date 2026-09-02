import { getDemandHeatmap, getReorderSuggestions, getExpiryRisk } from "@/lib/core/inventory";
import { listProducts } from "@/lib/core/catalog";
import { recordBatchAction } from "./actions";
import { BreakdownDonut } from "@/components/dashboard/MiniCharts";

const CLASS_LABEL: Record<string, { label: string; tint: string }> = {
  fast: { label: "Fast mover", tint: "kb-tint-mint" },
  slow: { label: "Slow mover", tint: "kb-tint-yellow" },
  dead: { label: "Dead stock", tint: "kb-tint-peach" },
  unrated: { label: "No sales data", tint: "kb-tint-blue" },
};

const CLASS_COLOR: Record<string, string> = {
  fast: "var(--kb-tint-mint-ink)",
  slow: "var(--kb-tint-yellow-ink)",
  dead: "var(--kb-tint-peach-ink)",
  unrated: "var(--kb-tint-blue-ink)",
};

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [heatmap, reorders, expiring, products] = await Promise.all([
    getDemandHeatmap(tenantId),
    getReorderSuggestions(tenantId),
    getExpiryRisk(tenantId),
    listProducts(tenantId),
  ]);

  const stockTracked = heatmap.filter((r) => r.stockQty != null);

  const classCounts = heatmap.reduce<Record<string, number>>((acc, r) => {
    acc[r.demandClass] = (acc[r.demandClass] ?? 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(classCounts).map(([cls, count]) => ({
    name: CLASS_LABEL[cls]?.label ?? cls,
    value: count,
    color: CLASS_COLOR[cls] ?? "#94a3b8",
  }));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Inventory optimization</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Demand ranked from your actual sales data — no manual stocktake needed to see what's
        hot, what's dead, and what's about to expire.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-4 self-start">
          <div className="kb-tile kb-tint-yellow">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">To reorder</p>
            <p className="mt-2 text-3xl font-extrabold">{reorders.length}</p>
          </div>
          <div className="kb-tile kb-tint-peach">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Expiring soon</p>
            <p className="mt-2 text-3xl font-extrabold">{expiring.length}</p>
          </div>
        </div>
        <BreakdownDonut title="Demand mix" data={donutData} />
      </div>

      {/* Reorder suggestions */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Reorder suggestions</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Items at or below their reorder point, sized to actual recent demand.
        </p>
        {reorders.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing needs reordering right now.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {reorders.map((r) => (
              <li key={r.itemId} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{r.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {r.stockQty} in stock · {r.unitsPerWeek.toFixed(1)}/week
                  </p>
                </div>
                <span className="kb-pill kb-pill-primary text-xs">
                  Order {r.suggestedQty}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Expiry risk */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Expiring soon</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Batches expiring within 14 days — markdown or clear these before they're a write-off.
        </p>
        {expiring.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing tracked as expiring soon.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {expiring.map((e) => (
              <li key={e.batchId} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{e.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{e.quantity} units</p>
                </div>
                <span className="kb-pill kb-pill-ghost text-xs">
                  {e.daysUntilExpiry <= 0 ? "Expired" : `${e.daysUntilExpiry}d left`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form action={recordBatchAction} className="kb-card mt-4 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Item</span>
            <select name="itemId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Quantity</span>
            <input type="number" name="quantity" min={1} required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Expires (optional)</span>
            <input type="date" name="expiresAt" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Log batch</button>
        </form>
      </section>

      {/* Demand heatmap */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Demand heatmap</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Every product ranked by sales velocity over the last 30 days.
        </p>
        {stockTracked.length === 0 && heatmap.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            No products yet — add some to your catalog to see demand here.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {heatmap.map((row) => {
              const cls = CLASS_LABEL[row.demandClass];
              const trending = row.unitsPerWeek - row.trendUnitsPerWeek;
              return (
                <li key={row.itemId} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="font-medium text-[var(--kb-text)]">{row.name}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {row.unitsPerWeek.toFixed(1)}/week
                      {trending !== 0 && (
                        <span className={trending > 0 ? "text-green-600" : "text-red-500"}>
                          {" "}({trending > 0 ? "↑" : "↓"} vs prior 30d)
                        </span>
                      )}
                      {row.weeksOfCover != null && ` · ${row.weeksOfCover.toFixed(1)}wk cover`}
                    </p>
                  </div>
                  <span className={`kb-tile ${cls.tint} !py-1 !px-3 text-[11px] font-semibold`}>
                    {cls.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
