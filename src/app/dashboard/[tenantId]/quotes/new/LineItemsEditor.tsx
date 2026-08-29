"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export interface LineItemValue {
  itemId: string;
  itemName: string;
  quantity: number;
  priceRand: number;
}

function money(rand: number) {
  return rand.toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

let nextRowKey = 1;

export function LineItemsEditor({
  products,
  initialLines,
}: {
  products: { id: string; name: string; unitPriceCents: number }[];
  initialLines?: LineItemValue[];
}) {
  const [rows, setRows] = useState<(LineItemValue & { key: number })[]>(() =>
    (initialLines?.length ? initialLines : [{ itemId: "", itemName: "", quantity: 1, priceRand: 0 }]).map(
      (l) => ({ ...l, key: nextRowKey++ })
    )
  );

  function updateRow(key: number, patch: Partial<LineItemValue>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleNameChange(key: number, value: string) {
    const match = products.find((p) => p.name === value);
    updateRow(key, {
      itemName: value,
      itemId: match?.id ?? "",
      ...(match ? { priceRand: match.unitPriceCents / 100 } : {}),
    });
  }

  function addRow() {
    setRows((rs) => [...rs, { itemId: "", itemName: "", quantity: 1, priceRand: 0, key: nextRowKey++ }]);
  }

  function removeRow(key: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  const total = rows.reduce((sum, r) => sum + r.quantity * r.priceRand, 0);

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--kb-text)]">Item table</label>
      <div className="mt-1 overflow-x-auto rounded-xl border border-[var(--kb-panel-border)]">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--kb-panel-border)] bg-black/[0.02] text-xs uppercase text-[var(--kb-text-dim)]">
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="w-20 px-3 py-2 text-left font-medium">Qty</th>
              <th className="w-28 px-3 py-2 text-left font-medium">Rate</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-[var(--kb-panel-border)] last:border-0">
                <td className="px-3 py-2 align-top">
                  <input
                    list="product-catalog"
                    required
                    value={row.itemName}
                    onChange={(e) => handleNameChange(row.key, e.target.value)}
                    placeholder="Type or pick from your catalog..."
                    className={inputClass}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: Number(e.target.value) || 1 })}
                    className={inputClass}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={row.priceRand}
                    onChange={(e) => updateRow(row.key, { priceRand: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </td>
                <td className="px-3 py-2 text-right align-top text-[var(--kb-text)]">
                  {money(row.quantity * row.priceRand)}
                </td>
                <td className="px-1 py-2 align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                    aria-label="Remove row"
                    className="rounded-md px-1.5 py-1 text-[var(--kb-text-dim)] hover:bg-black/5 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </td>
                {/* Hidden inputs so the server action can read every row by index. */}
                <input type="hidden" name="lineItemId" value={row.itemId} />
                <input type="hidden" name="lineItemName" value={row.itemName} />
                <input type="hidden" name="lineQuantity" value={row.quantity} />
                <input type="hidden" name="linePriceRand" value={row.priceRand} />
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="product-catalog">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-2 text-xs font-semibold text-[var(--kb-accent-a)] hover:underline"
      >
        + Add another item
      </button>

      <div className="mt-3 flex justify-end border-t border-[var(--kb-panel-border)] pt-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium text-[var(--kb-text-dim)]">Total</span>
          <span className="text-base font-semibold text-[var(--kb-text)]">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}
