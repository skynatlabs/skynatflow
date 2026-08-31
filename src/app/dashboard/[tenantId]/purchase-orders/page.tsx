// PA job: the reorder-suggestion engine (src/lib/core/inventory.ts)
// already tells an owner what and how much to reorder — this is the
// "now actually send it" step: pick a supplier, tick the items, send a
// real purchase order email, and mark it received when stock arrives.

import { getReorderSuggestions } from "@/lib/core/inventory";
import { listPurchaseOrders } from "@/lib/core/purchaseOrders";
import { listCustomers } from "@/lib/core/parties";
import { addSupplierAction, createPurchaseOrderAction, sendPurchaseOrderAction, markReceivedAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PurchaseOrdersPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [reorderSuggestions, suppliers, purchaseOrders] = await Promise.all([
    getReorderSuggestions(tenantId),
    listCustomers(tenantId, ["SUPPLIER"]),
    listPurchaseOrders(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Purchase orders</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Reorder suggestions come straight from your sales velocity — the same numbers behind the
        Inventory heatmap. Tick what you want, pick a supplier, and send it.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Needs reordering</h2>
        {reorderSuggestions.length === 0 ? (
          <div className="kb-card mt-3 p-6 text-center text-sm text-[var(--kb-text-dim)]">
            Nothing is below its reorder point right now.
          </div>
        ) : suppliers.length === 0 ? (
          <div className="kb-card mt-3 p-4 text-sm text-[var(--kb-text-dim)]">
            {reorderSuggestions.length} item{reorderSuggestions.length === 1 ? "" : "s"} need
            reordering — add a supplier below first so you have somewhere to send the order.
          </div>
        ) : (
          <form action={createPurchaseOrderAction} className="kb-card mt-3 p-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <ul className="divide-y divide-[var(--kb-panel-border)]">
              {reorderSuggestions.map((s) => (
                <li key={s.itemId} className="flex items-center gap-3 py-2">
                  <input type="checkbox" name="itemId" value={s.itemId} defaultChecked className="h-4 w-4" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--kb-text)]">{s.name}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {s.stockQty} in stock (reorder at {s.reorderPoint}) · suggest ordering {s.suggestedQty}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-end gap-3">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Supplier</span>
                <select name="supplierId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="kb-pill kb-pill-primary text-xs">Create purchase order</button>
            </div>
          </form>
        )}

        <form action={addSupplierAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">New supplier name</span>
            <input name="name" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Email</span>
            <input name="email" type="email" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Phone</span>
            <input name="phone" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">Add supplier</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Order history</h2>
        {purchaseOrders.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">No purchase orders yet.</p>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {purchaseOrders.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{po.supplier.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {po.lines.map((l) => `${l.quantity}x ${l.item.name}`).join(", ")} · {money(po.totalCostCents)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="kb-pill kb-pill-ghost text-xs">{po.status}</span>
                  {po.status === "DRAFT" && (
                    <form action={sendPurchaseOrderAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="purchaseOrderId" value={po.id} />
                      <button type="submit" className="kb-pill kb-pill-primary text-xs">Send</button>
                    </form>
                  )}
                  {po.status === "SENT" && (
                    <form action={markReceivedAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="purchaseOrderId" value={po.id} />
                      <button type="submit" className="kb-pill kb-pill-ghost text-xs">Mark received</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
