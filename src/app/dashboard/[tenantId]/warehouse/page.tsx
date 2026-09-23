// The warehouse.
//
// Bins in walking order, because that is the only order that matters when
// somebody is holding a trolley. Underneath, the list where the headline
// stock figure and the bins disagree — which is normal, not a bug: stock
// arrives and is not put away, or is moved and not recorded. Reporting the
// gap is what makes a weekly cycle count worth doing.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listBins, unplacedStock } from "@/lib/core/warehouse";
import { listProducts } from "@/lib/core/catalog";
import { saveBinAction, putAwayAction, moveStockAction, countBinAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WarehousePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [bins, gaps, products, placements] = await Promise.all([
    listBins(tenantId),
    unplacedStock(tenantId),
    listProducts(tenantId),
    prisma.stockPlacement.findMany({
      where: { tenantId, quantity: { gt: 0 } },
      include: { item: { select: { name: true } }, bin: { select: { code: true, pickSequence: true } } },
      take: 500,
    }),
  ]);

  const byBin = new Map<string, typeof placements>();
  for (const p of placements) {
    const list = byBin.get(p.binId) ?? [];
    list.push(p);
    byBin.set(p.binId, list);
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Warehouse</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Not how many you have &mdash; where they are, and in what order to walk. A pick sends the
        batch that expires first even when it is further away, because a warehouse that picks by
        convenience writes off a pallet a quarter.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Bins</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{bins.length}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Lines placed</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {placements.length}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Products not fully placed</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{ color: gaps.length > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text)" }}
          >
            {gaps.length}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Bins, in walking order</h2>
      {bins.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          No bins yet. Add the rack labels below, in the order a picker passes them.
        </div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {bins.map((bin) => {
            const contents = byBin.get(bin.id) ?? [];
            return (
              <li key={bin.id} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-[var(--kb-text)]">
                    {bin.code}
                    {!bin.isPickable && (
                      <span className="ml-2 text-xs" style={{ color: "var(--kb-status-warn-ink)" }}>
                        held back
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-[var(--kb-text-dim)]">walk #{bin.pickSequence}</span>
                </div>
                {contents.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                    {contents.map((c) => `${c.item.name} ×${c.quantity}`).join("  ·  ")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--kb-text-dim)]">empty</p>
                )}
                {bin.note && <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{bin.note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {gaps.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Not in any bin</h2>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
            The difference between what the system says is on hand and what the bins add up to.
            Biggest gap first &mdash; this is the list a cycle count should work through.
          </p>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {gaps.slice(0, 20).map((gap) => (
              <li key={gap.itemId} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-sm text-[var(--kb-text)]">{gap.name}</span>
                <span className="text-xs tabular-nums text-[var(--kb-text-dim)]">
                  on hand {gap.stockQty} &middot; placed {gap.placedQty} &middot;{" "}
                  <span style={{ color: "var(--kb-status-warn-ink)" }}>
                    {gap.differenceQty > 0 ? "+" : ""}
                    {gap.differenceQty}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <form action={saveBinAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Add a bin</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Code</span>
              <input name="code" required placeholder="A-12-3" className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Walk order</span>
              <input name="pickSequence" type="number" min={0} defaultValue={0} className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--kb-text)]">
              <input type="checkbox" name="isPickable" defaultChecked />
              Pickable
            </label>
            <button type="submit" className="kb-pill text-xs">Add</button>
          </div>
          <label className="mt-2 block text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Note</span>
            <input name="note" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
        </form>

        {bins.length > 0 && products.length > 0 && (
          <form action={putAwayAction} className="kb-card p-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Put stock away</h3>
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="mt-3 grid gap-2">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Product</span>
                <select name="itemId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">Into bin</span>
                  <select name="binId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>{b.code}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">How many</span>
                  <input name="quantity" type="number" min={1} required className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
                </label>
                <button type="submit" className="kb-pill kb-pill-primary text-xs">Put away</button>
              </div>
            </div>
          </form>
        )}

        {bins.length > 1 && products.length > 0 && (
          <form action={moveStockAction} className="kb-card p-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Move stock</h3>
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="mt-3 grid gap-2">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Product</span>
                <select name="itemId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">From</span>
                  <select name="fromBinId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>{b.code}</option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">To</span>
                  <select name="toBinId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>{b.code}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">How many</span>
                  <input name="quantity" type="number" min={1} required className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
                </label>
                <button type="submit" className="kb-pill text-xs">Move</button>
              </div>
            </div>
          </form>
        )}

        {bins.length > 0 && products.length > 0 && (
          <form action={countBinAction} className="kb-card p-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Count a bin</h3>
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="mt-3 grid gap-2">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Bin</span>
                <select name="binId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>{b.code}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">Product</span>
                  <select name="itemId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">Counted</span>
                  <input name="countedQty" type="number" min={0} required className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
                </label>
                <button type="submit" className="kb-pill text-xs">Set</button>
              </div>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
