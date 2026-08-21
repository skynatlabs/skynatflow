import Link from "next/link";
import { listProducts } from "@/lib/core/catalog";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const products = await listProducts(tenantId, true);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Products &amp; services</h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Your reusable catalog — pick straight from here when building a quote instead of
            typing the same item from scratch every time.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/dashboard/${tenantId}/settings/templates`} className="kb-pill text-xs">
            Proposal templates
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/export`} className="kb-pill text-xs">
            Export
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/import`} className="kb-pill text-xs">
            Import from Zoho/QuickBooks/etc.
          </Link>
          <Link href={`/dashboard/${tenantId}/products/new`} className="kb-pill kb-pill-primary">
            + Add product
          </Link>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          No products yet. Add your first one — every quote after this gets faster.
        </div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/${tenantId}/products/${p.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-[var(--kb-panel-hover,rgba(0,0,0,0.02))]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-[var(--kb-text)]">{p.name}</p>
                    {!p.isActive && (
                      <span className="shrink-0 rounded-full bg-[var(--kb-tint-peach)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--kb-tint-peach-ink)]">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--kb-text-dim)]">
                    {[p.sku, p.category].filter(Boolean).join(" · ") || "No SKU or category"}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-[var(--kb-text)]">
                  {money(p.unitPriceCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
