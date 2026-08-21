import { listProducts } from "@/lib/core/catalog";
import { recordCashSaleAction } from "./actions";
import { ProductPicker } from "../quotes/new/ProductPicker";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export default async function CashSalePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const products = await listProducts(tenantId);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Cash sale</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        For the customer standing right in front of you — no quote step, marked paid immediately.
      </p>

      <form action={recordCashSaleAction} className="kb-card mt-6 space-y-4 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div>
          <label className={labelClass}>
            Customer name <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input
            name="customerName"
            placeholder="Leave blank for an anonymous walk-in"
            className={inputClass}
          />
        </div>
        <ProductPicker
          products={products.map((p) => ({ id: p.id, name: p.name, unitPriceCents: p.unitPriceCents }))}
          label="What's being sold"
        />
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Record sale — mark paid
        </button>
      </form>
    </main>
  );
}
