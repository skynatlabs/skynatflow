import { getShrinkageReport } from "@/lib/core/stocktake";
import { listProducts } from "@/lib/core/catalog";
import { recordStocktakeAction } from "./actions";

export default async function StocktakePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [shrinkage, products] = await Promise.all([
    getShrinkageReport(tenantId),
    listProducts(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Stocktake &amp; shrinkage</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Count what's actually on the shelf — any gap against the system is flagged here instead of
        surfacing months later as an unexplained margin loss.
      </p>

      <form action={recordStocktakeAction} className="kb-card mt-6 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Item</span>
          <select name="itemId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (system: {p.stockQty ?? 0})</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Counted quantity</span>
          <input name="countedQty" type="number" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">Record count</button>
      </form>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Variance history</h2>
      {shrinkage.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">No variance recorded yet.</div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {shrinkage.map((s) => (
            <li key={s.stocktakeId} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{s.itemName}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  Expected {s.expectedQty}, counted {s.countedQty} · by {s.countedByName}
                </p>
              </div>
              <span className={`kb-tile ${s.varianceQty < 0 ? "kb-tint-peach" : "kb-tint-mint"} !py-1 !px-3 text-[11px] font-semibold`}>
                {s.varianceQty > 0 ? "+" : ""}{s.varianceQty}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
