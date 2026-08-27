import { listProperties, listLeases, getExpiringLeases } from "@/lib/core/property";
import { listCustomers } from "@/lib/core/parties";
import { addPropertyAction, addLeaseAction, endLeaseAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PropertiesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [properties, leases, expiring, renters] = await Promise.all([
    listProperties(tenantId),
    listLeases(tenantId),
    getExpiringLeases(tenantId),
    listCustomers(tenantId),
  ]);
  const availableProperties = properties.filter((p) => p.status === "AVAILABLE");

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Properties &amp; leases</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Property sales, leasing, and management — one record per property, one per tenancy.
      </p>

      {expiring.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--kb-tint-peach-ink)]">Leases expiring soon</h2>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {expiring.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-5 py-3">
                <p className="font-medium text-[var(--kb-text)]">{l.property.address} — {l.renterParty.name}</p>
                <p className="text-xs text-[var(--kb-tint-peach-ink)]">ends {l.endDate?.toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Properties</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {properties.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{p.address}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{p.propertyType}</p>
              </div>
              <span className="kb-pill kb-pill-ghost text-xs">{p.status}</span>
            </li>
          ))}
          {properties.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No properties yet.</li>
          )}
        </ul>

        <form action={addPropertyAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Address</span>
            <input name="address" required className="mt-1 w-56 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Type</span>
            <select name="propertyType" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              <option value="RESIDENTIAL">Residential</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="LAND">Land</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Monthly rent (R, optional)</span>
            <input name="rentalRateRand" type="number" step="0.01" className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Add property</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Leases</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {leases.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{l.property.address} → {l.renterParty.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {money(l.monthlyRentCents)}/mo · since {l.startDate.toLocaleDateString()}
                </p>
              </div>
              {l.status === "ACTIVE" ? (
                <form action={endLeaseAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="leaseId" value={l.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost text-xs">End lease</button>
                </form>
              ) : (
                <span className="kb-pill kb-pill-ghost text-xs">{l.status}</span>
              )}
            </li>
          ))}
          {leases.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No leases yet.</li>
          )}
        </ul>

        <form action={addLeaseAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Property</span>
            <select name="propertyId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {availableProperties.map((p) => (
                <option key={p.id} value={p.id}>{p.address}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Renter</span>
            <select name="renterPartyId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {renters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Start date</span>
            <input name="startDate" type="date" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Monthly rent (R)</span>
            <input name="monthlyRentRand" type="number" step="0.01" required className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Start lease</button>
        </form>
      </section>
    </main>
  );
}
