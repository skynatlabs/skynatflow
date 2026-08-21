"use client";

import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export function ProductPicker({
  products,
}: {
  products: { id: string; name: string; unitPriceCents: number }[];
}) {
  const [itemName, setItemName] = useState("");
  const [priceRand, setPriceRand] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");

  function handleNameChange(value: string) {
    setItemName(value);
    const match = products.find((p) => p.name === value);
    if (match) {
      setPriceRand((match.unitPriceCents / 100).toString());
      setSelectedItemId(match.id);
    } else {
      setSelectedItemId("");
    }
  }

  return (
    <>
      <div>
        <label className={labelClass}>What&apos;s the quote for</label>
        <input
          name="itemName"
          list="product-catalog"
          required
          value={itemName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={products.length ? "Start typing to pick from your catalog..." : undefined}
          className={inputClass}
        />
        <datalist id="product-catalog">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <input type="hidden" name="itemId" value={selectedItemId} />
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={labelClass}>Quantity</label>
          <input name="quantity" type="number" defaultValue={1} min={1} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Price (ZAR)</label>
          <input
            name="priceRand"
            type="number"
            step="0.01"
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
