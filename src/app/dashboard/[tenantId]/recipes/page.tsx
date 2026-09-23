// Recipes.
//
// The menu is listed worst margin first, for the same reason the margins
// page sorts that way: a menu ordered by name hides the two dishes losing
// money among the thirty that are not.
//
// Ingredients with no cost on them are named rather than counted as free.
// A plate cost that quietly assumes zero for the two things nobody priced is
// the number this page exists to replace.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { listProducts } from "@/lib/core/catalog";
import { menuMargins, getRecipe } from "@/lib/core/recipes";
import { saveRecipeAction, deleteRecipeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ dish?: string }>;
}) {
  const { tenantId } = await params;
  const { dish } = await searchParams;
  await requireTenantAccess(tenantId);

  const [rows, products, currency] = await Promise.all([
    menuMargins(tenantId),
    listProducts(tenantId),
    tenantCurrency(tenantId),
  ]);
  const editing = dish ? await getRecipe(tenantId, dish) : null;

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const sellable = products.filter((p) => p.isActive);
  const existing = new Map(editing?.components.map((c) => [c.componentItemId, c]) ?? []);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Recipes</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        What each dish is made of. Selling one takes its ingredients off the shelf, so the next
        stock count shows the difference between what should have been used and what actually
        was &mdash; which is where the margin goes.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Worst margin first</h2>
      {rows.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          No recipes yet. Pick a dish below and say what goes into it.
        </div>
      ) : (
        <div className="kb-card mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="p-3">Dish</th>
                <th className="p-3 text-right">Sells for</th>
                <th className="p-3 text-right">Costs to make</th>
                <th className="p-3 text-right">Margin</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dishItemId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                  <td className="p-3 text-[var(--kb-text)]">
                    {row.dishName}
                    {row.missingCosts > 0 && (
                      <span className="ml-2 text-xs" style={{ color: "var(--kb-status-warn-ink)" }}>
                        {row.missingCosts} ingredient{row.missingCosts === 1 ? "" : "s"} with no cost
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                    {money(row.sellingCents)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">
                    {money(row.costCents)}
                  </td>
                  <td
                    className="p-3 text-right tabular-nums"
                    style={{
                      color:
                        row.marginPercent !== null && row.marginPercent < 20
                          ? "var(--kb-status-danger-ink)"
                          : "var(--kb-text)",
                    }}
                  >
                    {row.marginPercent === null ? "—" : `${row.marginPercent}%`}
                  </td>
                  <td className="p-3 text-right">
                    <a href={`?dish=${row.dishItemId}`} className="kb-pill text-xs">
                      Edit
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">
        {editing ? `What goes into ${editing.dishItem.name}` : "Write a recipe"}
      </h2>
      <form action={saveRecipeAction} className="kb-card mt-3 p-5">
        <input type="hidden" name="tenantId" value={tenantId} />

        <div className="flex flex-wrap gap-4">
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Dish</span>
            {editing ? (
              <>
                <input type="hidden" name="dishItemId" value={editing.dishItemId} />
                <p className="mt-1 text-sm font-medium text-[var(--kb-text)]">
                  {editing.dishItem.name}
                </p>
              </>
            ) : (
              <select
                name="dishItemId"
                required
                className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                {sellable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Portions it makes</span>
            <input
              name="yieldQty"
              type="number"
              min={1}
              defaultValue={editing?.yieldQty ?? 1}
              className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>

          <label className="flex-1 text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Note (optional)</span>
            <input
              name="note"
              defaultValue={editing?.note ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>
        </div>

        <p className="mt-5 text-xs font-medium text-[var(--kb-text-dim)]">
          Amount per batch, in the ingredient&apos;s own stock unit. A fifth of an onion is 0.2 —
          the part-used remainder is carried, so five plates take exactly one onion.
        </p>

        <ul className="mt-2 max-h-80 divide-y divide-[var(--kb-panel-border)] overflow-y-auto rounded-md border border-[var(--kb-panel-border)]">
          {products.map((p) => {
            const current = existing.get(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <input type="hidden" name="componentItemId" value={p.id} />
                <span className="flex-1 text-sm text-[var(--kb-text)]">
                  {p.name}
                  {p.unit && <span className="ml-1 text-xs text-[var(--kb-text-dim)]">/{p.unit}</span>}
                  {p.costCents === null && (
                    <span className="ml-2 text-xs" style={{ color: "var(--kb-status-warn-ink)" }}>
                      no cost set
                    </span>
                  )}
                </span>
                <input
                  name="amount"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="—"
                  defaultValue={current ? current.quantityThousandths / 1000 : ""}
                  className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-sm"
                />
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex gap-2">
          <button type="submit" className="kb-pill kb-pill-primary text-xs">
            Save recipe
          </button>
          {editing && (
            <a href="?" className="kb-pill text-xs">
              Start a different one
            </a>
          )}
        </div>
      </form>

      {editing && (
        <form action={deleteRecipeAction} className="mt-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="dishItemId" value={editing.dishItemId} />
          <button type="submit" className="kb-pill text-xs">
            Remove this recipe
          </button>
        </form>
      )}
    </main>
  );
}
