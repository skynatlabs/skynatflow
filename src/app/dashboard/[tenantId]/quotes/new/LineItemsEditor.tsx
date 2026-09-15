"use client";

import { useEffect, useState } from "react";
import { computeDocumentTotal } from "@/lib/core/pricing";
import { ProductSearch } from "@/components/dashboard/ProductSearch";

// Lets an external client component (SmartEntryBox) push a fresh set of
// rows in after this component has already mounted — initialLines only
// seeds React state once at mount, so replacing the prop later wouldn't
// re-render existing rows. Registered on window rather than lifted state/
// context since there's exactly one of these per page and no ancestor
// component that needs to know about it.
declare global {
  interface Window {
    __setQuoteLineItems?: (lines: LineItemValue[], documentDiscountPercent?: number) => void;
  }
}

const inputClass =
  "w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2.5 py-2 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

export interface LineItemValue {
  itemId: string;
  itemName: string;
  /** Shown under the item for a catalogue line. */
  sku?: string | null;
  quantity: number;
  priceRand: number;
  discountPercent?: number;
  taxRatePercent?: number;
  /** What this line says on the document, when the product's name is not it. */
  description?: string | null;
  /** How it is sold on this line: each, hour, kg, pallet. */
  unit?: string | null;
}

function money(rand: number) {
  return rand.toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}
function centsToRand(cents: number) {
  return money(cents / 100);
}

let nextRowKey = 1;

export function LineItemsEditor({
  tenantId,
  initialLines,
  initialDocumentDiscountPercent,
}: {
  tenantId: string;
  initialLines?: LineItemValue[];
  initialDocumentDiscountPercent?: number;
}) {
  const [rows, setRows] = useState<(LineItemValue & { key: number })[]>(() =>
    (initialLines?.length ? initialLines : [{ itemId: "", itemName: "", quantity: 1, priceRand: 0 }]).map(
      (l) => ({ ...l, key: nextRowKey++ })
    )
  );
  const [documentDiscountPercent, setDocumentDiscountPercent] = useState(initialDocumentDiscountPercent ?? 0);

  useEffect(() => {
    window.__setQuoteLineItems = (lines, docDiscount) => {
      setRows(lines.map((l) => ({ ...l, key: nextRowKey++ })));
      if (docDiscount !== undefined) setDocumentDiscountPercent(docDiscount);
    };
    return () => {
      delete window.__setQuoteLineItems;
    };
  }, []);

  function updateRow(key: number, patch: Partial<LineItemValue>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleType(key: number, value: string) {
    // Typing after picking turns the line back into free text: the name no
    // longer names the catalogue item, so it must not stay linked to it.
    updateRow(key, { itemName: value, itemId: "", sku: null });
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
              const gross = row.quantity * Math.round(row.priceRand * 100);
              const beforeTaxCents = gross * (1 - (row.discountPercent ?? 0) / 100);
              const taxCents = beforeTaxCents * ((row.taxRatePercent ?? 0) / 100);
              return (
                <tr key={row.key} className="border-b border-[var(--kb-panel-border)] last:border-0">
                  <td className="px-3 py-2 align-top">
                    <ProductSearch
                      tenantId={tenantId}
                      required
                      value={row.itemName}
                      selectedId={row.itemId}
                      onType={(v) => handleType(row.key, v)}
                      onSelect={(p) =>
                        updateRow(row.key, {
                          itemId: p.id,
                          itemName: p.name,
                          sku: p.sku,
                          priceRand: p.unitPriceCents / 100,
                          taxRatePercent: p.taxRatePercent ?? undefined,
                          unit: p.unit ?? row.unit ?? null,
                        })
                      }
                      onEdited={(p) =>
                        updateRow(row.key, {
                          itemName: p.name,
                          sku: p.sku,
                          priceRand: p.unitPriceCents / 100,
                          taxRatePercent: p.taxRatePercent ?? undefined,
                        })
                      }
                      className={inputClass}
                    />
                    {row.sku && <p className="mt-0.5 text-[10px] text-[var(--kb-text-dim)]">SKU: {row.sku}</p>}
                    {/* The same product is described differently on two jobs.
                        What the customer agreed to is what this says. */}
                    <input
                      value={row.description ?? ""}
                      onChange={(e) => updateRow(row.key, { description: e.target.value })}
                      placeholder="Say more about this line — optional"
                      className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--kb-text-dim)] placeholder:text-[var(--kb-text-dim)] hover:border-[var(--kb-panel-border)] focus:border-[var(--kb-accent-a)] focus:outline-none"
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
                    <input
                      value={row.unit ?? ""}
                      onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                      placeholder="each"
                      className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--kb-text-dim)] placeholder:text-[var(--kb-text-dim)] hover:border-[var(--kb-panel-border)] focus:border-[var(--kb-accent-a)] focus:outline-none"
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
                    {/* Hidden inputs so the server action can read every row by index. */}
                    <input type="hidden" name="lineItemId" value={row.itemId} />
                    <input type="hidden" name="lineItemName" value={row.itemName} />
                    <input type="hidden" name="lineQuantity" value={row.quantity} />
                    <input type="hidden" name="linePriceRand" value={row.priceRand} />
                    <input type="hidden" name="lineDiscountPercent" value={row.discountPercent ?? 0} />
                    <input type="hidden" name="lineTaxRatePercent" value={row.taxRatePercent ?? ""} />
                    <input type="hidden" name="lineDescription" value={row.description ?? ""} />
                    <input type="hidden" name="lineUnit" value={row.unit ?? ""} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              className="w-16 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1 text-sm"
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
