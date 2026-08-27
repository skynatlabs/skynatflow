import { getActiveRentals, getOverdueRentals } from "@/lib/core/rentals";
import { listProducts } from "@/lib/core/catalog";
import { listCustomers } from "@/lib/core/parties";
import { markRentableAction, createRentalAction, returnRentalAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function RentalsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [active, overdue, products, customers] = await Promise.all([
    getActiveRentals(tenantId),
    getOverdueRentals(tenantId),
    listProducts(tenantId),
    listCustomers(tenantId),
  ]);
  const rentableProducts = products.filter((p) => p.isRentable);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Rentals</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Any item in your catalog can be rented out instead of only sold — you&apos;re not tied to
        selling only.
      </p>

      {overdue.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--kb-tint-peach-ink)]">Overdue returns</h2>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {overdue.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{r.item.name} → {r.party.name}</p>
                  <p className="text-xs text-[var(--kb-tint-peach-ink)]">
                    was due {r.endAt?.toLocaleDateString()}
                  </p>
                </div>
                <form action={returnRentalAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="rentalId" value={r.id} />
                  <button type="submit" className="kb-pill kb-pill-primary text-xs">Mark returned</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Active rentals</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {active.filter((r) => !overdue.some((o) => o.id === r.id)).map((r) => (
            <li key={r.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{r.item.name} → {r.party.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {money(r.rateCents)}/{r.rateUnit.toLowerCase()} · since {r.startAt.toLocaleDateString()}
                </p>
              </div>
              <form action={returnRentalAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="rentalId" value={r.id} />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">Mark returned</button>
              </form>
            </li>
          ))}
          {active.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No rentals out right now.</li>
          )}
        </ul>

        <form action={createRentalAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Item</span>
            <select name="itemId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {rentableProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Renter</span>
            <select name="partyId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Expected return (optional)</span>
            <input name="endAt" type="date" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Start rental</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Mark a product rentable</h2>
        <form action={markRentableAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
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
            <span className="block font-medium text-[var(--kb-text-dim)]">Rate (R)</span>
            <input name="rateRand" type="number" step="0.01" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Per</span>
            <select name="rateUnit" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              <option value="HOUR">Hour</option>
              <option value="DAY">Day</option>
              <option value="WEEK">Week</option>
              <option value="MONTH">Month</option>
            </select>
          </label>
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">Save</button>
        </form>
      </section>
    </main>
  );
}
