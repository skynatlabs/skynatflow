"use client";

import { useState } from "react";
import { computeDocumentTotal } from "@/lib/core/pricing";

const inputClass =
  "w-full rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export interface LineItemValue {
  itemId: string;
  itemName: string;
  quantity: number;
  priceRand: number;
  discountPercent?: number;
  taxRatePercent?: number;
}

function money(rand: number) {
  return rand.toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}
function centsToRand(cents: number) {
  return money(cents / 100);
}

let nextRowKey = 1;

export function LineItemsEditor({
  products,
  initialLines,
  initialDocumentDiscountPercent,
}: {
  products: { id: string; name: string; unitPriceCents: number; sku?: string | null; taxRatePercent?: number | null }[];
  initialLines?: LineItemValue[];
  initialDocumentDiscountPercent?: number;
}) {
  const [rows, setRows] = useState<(LineItemValue & { key: number })[]>(() =>
    (initialLines?.length ? initialLines : [{ itemId: "", itemName: "", quantity: 1, priceRand: 0 }]).map(
      (l) => ({ ...l, key: nextRowKey++ })
    )
  );
  const [documentDiscountPercent, setDocumentDiscountPercent] = useState(initialDocumentDiscountPercent ?? 0);

  function updateRow(key: number, patch: Partial<LineItemValue>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleNameChange(key: number, value: string) {
    const match = products.find((p) => p.name === value);
    updateRow(key, {
      itemName: value,
      itemId: match?.id ?? "",
      ...(match
        ? {
            priceRand: match.unitPriceCents / 100,
            taxRatePercent: match.taxRatePercent ?? undefined,
          }
        : {}),
    });
  }

  function addRow() {
    setRows((rs) => [...rs, { itemId: "", itemName: "", quantity: 1, priceRand: 0, key: nextRowKey++ }]);
  }

  function removeRow(key: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  const breakdown = computeDocumentTotal(
    rows.map((r) => ({
      quantity: r.quantity,
      unitPriceCents: Math.round(r.priceRand * 100),
      discountPercent: r.discountPercent,
      taxRatePercent: r.taxRatePercent,
    })),
    documentDiscountPercent
  );

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--kb-text)]">Item table</label>
      <div className="mt-1 overflow-x-auto rounded-xl border border-[var(--kb-panel-border)]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--kb-panel-border)] bg-black/[0.02] text-xs uppercase text-[var(--kb-text-dim)]">
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="w-16 px-3 py-2 text-left font-medium">Qty</th>
              <th className="w-24 px-3 py-2 text-left font-medium">Rate</th>
              <th className="w-20 px-3 py-2 text-left font-medium">Disc %</th>
              <th className="w-20 px-3 py-2 text-left font-medium">Tax %</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const match = products.find((p) => p.id === row.itemId);
              const gross = row.quantity * Math.round(row.priceRand * 100);
              const beforeTaxCents = gross * (1 - (row.discountPercent ?? 0) / 100);
              const taxCents = beforeTaxCents * ((row.taxRatePercent ?? 0) / 100);
              return (
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
                    {match?.sku && <p className="mt-0.5 text-[10px] text-[var(--kb-text-dim)]">SKU: {match.sku}</p>}
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
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="1"
                      min={0}
                      max={100}
                      value={row.discountPercent ?? 0}
                      onChange={(e) => updateRow(row.key, { discountPercent: Number(e.target.value) || 0 })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="1"
                      min={0}
                      max={100}
                      value={row.taxRatePercent ?? ""}
                      placeholder="0"
                      onChange={(e) =>
                        updateRow(row.key, {
                          taxRatePercent: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top text-[var(--kb-text)]">
                    {centsToRand(beforeTaxCents + taxCents)}
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
                  <input type="hidden" name="lineDiscountPercent" value={row.discountPercent ?? 0} />
                  <input type="hidden" name="lineTaxRatePercent" value={row.taxRatePercent ?? ""} />
                </tr>
              );
            })}
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

      <div className="mt-3 space-y-1.5 border-t border-[var(--kb-panel-border)] pt-3">
        <div className="flex justify-between text-sm text-[var(--kb-text-dim)]">
          <span>Subtotal</span>
          <span>{centsToRand(breakdown.subtotalCents)}</span>
        </div>
        {breakdown.lineDiscountCents > 0 && (
          <div className="flex justify-between text-sm text-[var(--kb-text-dim)]">
            <span>Line discounts</span>
            <span>&minus;{centsToRand(breakdown.lineDiscountCents)}</span>
          </div>
        )}
        {breakdown.taxCents > 0 && (
          <div className="flex justify-between text-sm text-[var(--kb-text-dim)]">
            <span>Tax</span>
            <span>{centsToRand(breakdown.taxCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-sm text-[var(--kb-text-dim)]">
          <label className="flex items-center gap-2">
            <span>Overall discount %</span>
            <input
              type="number"
              step="1"
              min={0}
              max={100}
              value={documentDiscountPercent}
              onChange={(e) => setDocumentDiscountPercent(Number(e.target.value) || 0)}
              className="w-16 rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-sm"
            />
          </label>
          <span>&minus;{centsToRand(breakdown.documentDiscountCents)}</span>
        </div>
        <input type="hidden" name="documentDiscountPercent" value={documentDiscountPercent} />
        <div className="flex justify-end gap-4 border-t border-[var(--kb-panel-border)] pt-2">
          <span className="font-medium text-[var(--kb-text-dim)]">Total</span>
          <span className="text-base font-semibold text-[var(--kb-text)]">{centsToRand(breakdown.totalCents)}</span>
        </div>
      </div>
    </div>
  );
}
