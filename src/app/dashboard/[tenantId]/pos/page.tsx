import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/core/catalog";
import { openTillAction, closeTillAction, checkoutAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PosPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [openSession, lastClosedSession, products] = await Promise.all([
    prisma.tillSession.findFirst({ where: { tenantId, closedAt: null }, orderBy: { openedAt: "desc" } }),
    prisma.tillSession.findFirst({ where: { tenantId, closedAt: { not: null } }, orderBy: { closedAt: "desc" } }),
    listProducts(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Point of sale</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Your own built-in till — scan/select an item, take cash or card, and reconcile at close-out.
      </p>

      {!openSession && lastClosedSession?.varianceCents != null && lastClosedSession.varianceCents !== 0 && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ Last till close-out was{" "}
          {lastClosedSession.varianceCents > 0 ? "over" : "short"} by {money(Math.abs(lastClosedSession.varianceCents))}
          {" "}({lastClosedSession.closedAt?.toLocaleString()}) — worth a look before opening today's till.
        </div>
      )}

      {!openSession ? (
        <form action={openTillAction} className="kb-card mt-6 flex flex-wrap items-end gap-3 p-5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Opening float (R)</span>
            <input name="openingFloatRand" type="number" step="0.01" required className="mt-1 w-32 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Open till</button>
        </form>
      ) : (
        <>
          <div className="kb-card mt-6 p-5">
            <p className="text-sm text-[var(--kb-text-dim)]">
              Till open since {openSession.openedAt.toLocaleTimeString()} · float {money(openSession.openingFloatCents)}
            </p>
          </div>

          <section className="mt-6">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">Checkout</h2>
            <form action={checkoutAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="tillSessionId" value={openSession.id} />
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Item (SKU-searchable)</span>
                <select name="itemId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.sku ? `${p.sku} — ` : ""}{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Qty</span>
                <input name="quantity" type="number" min={1} defaultValue={1} className="mt-1 w-16 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Price (R)</span>
                <input name="priceRand" type="number" step="0.01" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Payment</span>
                <select name="paymentMethod" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </label>
              <button type="submit" className="kb-pill kb-pill-primary text-xs">Charge</button>
            </form>
          </section>

          <section className="mt-6">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">Close till</h2>
            <form action={closeTillAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="sessionId" value={openSession.id} />
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Counted cash (R)</span>
                <input name="closingCountedRand" type="number" step="0.01" required className="mt-1 w-32 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">Close &amp; reconcile</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
