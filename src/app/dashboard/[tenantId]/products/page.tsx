import Link from "next/link";
import { listProductsPaginated } from "@/lib/core/catalog";
import { prisma } from "@/lib/db";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";

const CATEGORY_COLORS = [
  "var(--kb-accent-a)",
  "var(--kb-tint-mint-ink)",
  "var(--kb-tint-yellow-ink)",
  "var(--kb-tint-blue-ink)",
  "var(--kb-tint-peach-ink)",
  "var(--kb-tint-violet-ink)",
];

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
  const [{ items: products, total, pageCount }, categoryGroups] = await Promise.all([
    listProductsPaginated(tenantId, page),
    prisma.item.groupBy({ by: ["category"], where: { tenantId }, _count: { _all: true } }),
  ]);

  const barData = categoryGroups
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 8)
    .map((g, i) => ({
      name: g.category ?? "Uncategorized",
      value: g._count._all,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));

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

      {barData.length > 0 && (
        <div className="mt-6">
          <BreakdownBarChart title="Products by category" data={barData} />
        </div>
      )}

      {products.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          No products yet. Add your first one — every quote after this gets faster.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/${tenantId}/products/${p.id}`}
              className="kb-tile kb-tint-mint transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{p.name}</p>
                {!p.isActive && (
                  <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase">
                    Hidden
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs opacity-70">
                {[p.sku, p.category].filter(Boolean).join(" · ") || "No SKU or category"}
              </p>
              <p className="mt-3 text-lg font-extrabold">{money(p.unitPriceCents)}</p>
            </Link>
          ))}
        </div>
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
