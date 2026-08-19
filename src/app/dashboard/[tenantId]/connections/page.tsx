// Wholesaler-retailer network layer (strategic report, Section 11). Any
// tenant can invite any other tenant to connect — not gated to WHOLESALE
// niche specifically, since a retailer might supply another retailer, a
// logistics operator might connect to both ends, etc.

import { listConnectionsForTenant } from "@/lib/core/connections";
import { prisma } from "@/lib/db";
import { inviteConnectionAction, acceptConnectionAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const connections = await listConnectionsForTenant(tenantId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Trading connections</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Connect <span className="text-[var(--kb-text)]">{tenant.name}</span> directly to
        another workspace on the platform — orders flow straight into their
        normal pipeline, no re-keying.
      </p>

      <form action={inviteConnectionAction} className="kb-card mt-6 space-y-3 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">
            Workspace name to connect with
          </label>
          <input name="buyerTenantName" required className={inputClass} placeholder="Demo Corner Store" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">
            Discount for this account (%)
          </label>
          <input name="discountPercent" type="number" step="0.1" className={inputClass} placeholder="0" />
        </div>
        <button type="submit" className="kb-pill kb-pill-primary">
          Send invite
        </button>
      </form>

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {connections.map((c) => {
          const isSupplier = c.supplierTenantId === tenantId;
          const other = isSupplier ? c.buyerTenant : c.supplierTenant;
          return (
            <li key={c.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{other.name}</p>
                <p className="text-[var(--kb-text-dim)]">
                  {isSupplier ? "They buy from you" : "You buy from them"} &middot; {c.status}
                  {c.discountPercent ? ` · ${c.discountPercent}% off` : ""}
                </p>
              </div>
              {c.status === "PENDING" && !isSupplier && (
                <form action={acceptConnectionAction}>
                  <input type="hidden" name="connectionId" value={c.id} />
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <button type="submit" className="kb-pill kb-pill-ghost">
                    Accept
                  </button>
                </form>
              )}
            </li>
          );
        })}
        {connections.length === 0 && (
          <li className="p-4 text-sm text-[var(--kb-text-dim)]">No connections yet.</li>
        )}
      </ul>
    </main>
  );
}
