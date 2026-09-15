"use client";

import { useState } from "react";
import { ProductSearch } from "@/components/dashboard/ProductSearch";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export function ProductPicker({
  tenantId,
  label = "What's the quote for",
}: {
  tenantId: string;
  label?: string;
}) {
  const [itemName, setItemName] = useState("");
  const [priceRand, setPriceRand] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");

  return (
    <>
      <div>
        <label className={labelClass}>{label}</label>
        <ProductSearch
          tenantId={tenantId}
          name="itemName"
          required
          value={itemName}
          selectedId={selectedItemId}
          onType={(v) => {
            setItemName(v);
            setSelectedItemId("");
          }}
          onSelect={(p) => {
            setItemName(p.name);
            setSelectedItemId(p.id);
            setPriceRand((p.unitPriceCents / 100).toString());
          }}
          onEdited={(p) => {
            setItemName(p.name);
            setPriceRand((p.unitPriceCents / 100).toString());
          }}
          className={inputClass}
        />
        <input type="hidden" name="itemId" value={selectedItemId} />
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>Quantity</label>
          <input name="quantity" type="number" defaultValue={1} min={1} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Price</label>
          <input
            name="priceRand"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={priceRand}
            onChange={(e) => setPriceRand(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </>
  );
}
