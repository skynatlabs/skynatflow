import Link from "next/link";
import { listProductsPaginated } from "@/lib/core/catalog";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const { items: products, total, pageCount } = await listProductsPaginated(tenantId, page);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">
            Products &amp; services <span className="text-sm font-normal text-[var(--kb-text-dim)]">({total})</span>
          </h1>
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
          <Link href={`/dashboard/${tenantId}/settings/pos-integrations`} className="kb-pill text-xs">
            POS integrations
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/pdf-templates`} className="kb-pill text-xs">
            PDF templates
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/mail`} className="kb-pill text-xs">
            Mail
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/automation`} className="kb-pill text-xs">
            Follow-up automation
          </Link>
          <Link href={`/dashboard/${tenantId}/settings/backup`} className="kb-pill text-xs">
            Account &amp; backup
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

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link
            href={`?page=${page - 1}`}
            aria-disabled={page <= 1}
            className={`kb-pill kb-pill-ghost text-xs ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            &larr; Prev
          </Link>
          <span className="text-[var(--kb-text-dim)]">
            Page {page} of {pageCount}
          </span>
          <Link
            href={`?page=${page + 1}`}
            aria-disabled={page >= pageCount}
            className={`kb-pill kb-pill-ghost text-xs ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`}
          >
            Next &rarr;
          </Link>
        </div>
      )}
    </main>
  );
}
