import { prisma } from "@/lib/db";
import {
  connectWooCommerceAction,
  disconnectWooCommerceAction,
  syncWooProductsAction,
} from "./actions";

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2.5 text-sm text-[var(--kb-text)]";

export default async function EcommercePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const integration = await prisma.ecommerceIntegration.findUnique({
    where: { tenantId_platform: { tenantId, platform: "WOOCOMMERCE" } },
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Ecommerce</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Connect your WordPress/WooCommerce store: pull your product catalog in, and every new order
        auto-generates a flow invoice — emailed to the customer from flow — the moment it comes in.
      </p>

      <div className="kb-card mt-6 p-6">
        <div className="flex items-center justify-between">
          <p className="font-medium text-[var(--kb-text)]">WooCommerce</p>
          {integration?.isActive && <span className="kb-pill kb-pill-primary text-xs">Connected</span>}
        </div>

        <form action={connectWooCommerceAction} className="mt-4 space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Store URL</label>
            <input
              name="storeUrl"
              placeholder="https://yourstore.com"
              defaultValue={integration?.storeUrl ?? ""}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Consumer key</label>
            <input
              name="consumerKey"
              placeholder="ck_..."
              defaultValue={integration?.consumerKey ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--kb-text)]">Consumer secret</label>
            <input name="consumerSecret" type="password" placeholder="cs_..." className={inputClass} />
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              WooCommerce → Settings → Advanced → REST API → Add key (Read/Write permissions).
            </p>
          </div>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">
            {integration ? "Update connection" : "Connect store"}
          </button>
        </form>

        {integration?.isActive && (
          <div className="mt-5 space-y-3 border-t border-[var(--kb-panel-border)] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kb-text)]">Product catalog</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {integration.lastProductSyncAt
                    ? `Last synced ${integration.lastProductSyncAt.toLocaleString()}`
                    : "Never synced"}
                </p>
              </div>
              <form action={syncWooProductsAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  Sync products now
                </button>
              </form>
            </div>
            <form action={disconnectWooCommerceAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <button type="submit" className="text-xs text-[var(--kb-text-dim)] hover:underline">
                Disconnect
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
