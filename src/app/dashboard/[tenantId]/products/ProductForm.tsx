const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export function ProductForm({
  action,
  tenantId,
  productId,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void;
  tenantId: string;
  productId?: string;
  initial?: {
    name: string;
    sku: string | null;
    hsnCode: string | null;
    category: string | null;
    imageUrl: string | null;
    unitPriceCents: number;
    costCents: number | null;
    taxRatePercent: number | null;
    stockQty: number | null;
    reorderPoint: number | null;
  };
  submitLabel: string;
}) {
  return (
    <form action={action} className="kb-card mt-6 space-y-4 p-6">
      <input type="hidden" name="tenantId" value={tenantId} />
      {productId && <input type="hidden" name="productId" value={productId} />}

      <div>
        <label className={labelClass}>Name</label>
        <input name="name" required defaultValue={initial?.name} className={inputClass} />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>
            SKU <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input name="sku" defaultValue={initial?.sku ?? ""} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>
            Category <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input name="category" defaultValue={initial?.category ?? ""} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>
            HSN / tax code <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input name="hsnCode" defaultValue={initial?.hsnCode ?? ""} className={inputClass} />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>Price (ZAR)</label>
          <input
            name="priceRand"
            type="number"
            step="0.01"
            required
            defaultValue={initial ? initial.unitPriceCents / 100 : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>
            Cost (ZAR) <span className="text-[var(--kb-text-dim)]">(for margin)</span>
          </label>
          <input
            name="costRand"
            type="number"
            step="0.01"
            defaultValue={initial?.costCents != null ? initial.costCents / 100 : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>
            Tax % <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input
            name="taxRatePercent"
            type="number"
            step="1"
            defaultValue={initial?.taxRatePercent ?? undefined}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>
            Stock qty <span className="text-[var(--kb-text-dim)]">(leave blank for services)</span>
          </label>
          <input
            name="stockQty"
            type="number"
            defaultValue={initial?.stockQty ?? undefined}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className={labelClass}>
            Reorder point <span className="text-[var(--kb-text-dim)]">(optional)</span>
          </label>
          <input
            name="reorderPoint"
            type="number"
            defaultValue={initial?.reorderPoint ?? undefined}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>
          Image URL <span className="text-[var(--kb-text-dim)]">(optional)</span>
        </label>
        <input name="imageUrl" defaultValue={initial?.imageUrl ?? ""} className={inputClass} />
      </div>

      <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
        {submitLabel}
      </button>
    </form>
  );
}
