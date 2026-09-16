"use client";

// The item field on a quote, invoice or cash sale: a live search, not a list.
//
// Typing searches the catalogue on the server — name, SKU, description and
// category, every word — and shows the matches with their price, SKU and
// stock under the field. Arrow keys and Enter pick one; Escape closes. With
// nothing typed, focusing the field shows what this business quotes most.
// Anything typed that is not in the catalogue is kept as a free-text line, as
// before. Once a catalogue item is picked, the pencil beside it opens that
// product for editing without leaving the document.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMoney } from "@/components/WorkspaceRegionProvider";

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  unitPriceCents: number;
  costCents: number | null;
  taxRatePercent: number | null;
  stockQty: number | null;
  category: string | null;
}


function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-[var(--kb-tint-yellow)] px-0.5 text-[var(--kb-text)]">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function ProductSearch({
  tenantId,
  value,
  selectedId,
  onType,
  onSelect,
  onEdited,
  canEdit = true,
  placeholder = "Search your catalogue, or type a new item…",
  className = "",
  required = false,
  name,
}: {
  tenantId: string;
  value: string;
  selectedId: string;
  /** Free text: the line is not (or no longer) a catalogue item. */
  onType: (text: string) => void;
  onSelect: (product: CatalogProduct) => void;
  /** The selected product was edited in the popup. */
  onEdited?: (product: CatalogProduct) => void;
  canEdit?: boolean;
  placeholder?: string;
  className?: string;
  required?: boolean;
  name?: string;
}) {
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [lastPicked, setLastPicked] = useState<CatalogProduct | null>(null);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Positioned against the viewport, not the field's parent: the item table
  // sits in a horizontal-scroll box, and that box clips anything absolutely
  // positioned inside it — which cut the results off below the first row.
  const [anchor, setAnchor] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard/${tenantId}/products/search?q=${encodeURIComponent(value)}`, { signal: controller.signal });
        if (res.ok) {
          const data = (await res.json()) as { results: CatalogProduct[] };
          setResults(data.results);
          setHighlight(0);
        }
      } catch {
        /* cancelled by the next keystroke */
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, open, tenantId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, 352), vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      const spaceBelow = vh - r.bottom;
      // Open upwards when the field is near the bottom of the screen — on a
      // phone that is where the keyboard pushes it.
      setAnchor(spaceBelow < 260 && r.top > spaceBelow ? { left, width, bottom: vh - r.top + 4 } : { left, width, top: r.bottom + 4 });
    };
    place();
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  function pick(p: CatalogProduct) {
    setLastPicked(p);
    onSelect(p);
    setOpen(false);
  }

  async function openEditor() {
    setOpen(false);
    if (lastPicked?.id === selectedId) {
      setEditing(lastPicked);
      return;
    }
    // A line loaded from a saved document: fetch the product by its name.
    const res = await fetch(`/api/dashboard/${tenantId}/products/search?q=${encodeURIComponent(value)}`);
    if (res.ok) {
      const data = (await res.json()) as { results: CatalogProduct[] };
      const hit = data.results.find((r) => r.id === selectedId) ?? null;
      if (hit) setEditing(hit);
    }
  }

  const showList = open && (results.length > 0 || value.trim().length > 0);
  const exact = results.some((r) => r.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          name={name}
          value={value}
          required={required}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onType(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(results.length - 1, h + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter" && results[highlight]) {
              e.preventDefault();
              pick(results[highlight]);
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
          className={className}
        />
        {selectedId && canEdit && (
          <button
            type="button"
            onClick={openEditor}
            title="Edit this product"
            aria-label="Edit this product"
            className="shrink-0 rounded-md px-1.5 py-1 text-[var(--kb-text-dim)] hover:bg-black/5 hover:text-[var(--kb-text)]"
          >
            ✎
          </button>
        )}
      </div>

      {showList && anchor && (
        <ul
          id={listId}
          role="listbox"
          className="kb-card fixed z-[60] max-h-80 overflow-y-auto p-1 shadow-xl"
          style={{ left: anchor.left, width: anchor.width, top: anchor.top, bottom: anchor.bottom }}
        >
          {loading && results.length === 0 && <li className="px-3 py-2 text-xs text-[var(--kb-text-dim)]">Searching…</li>}
          {!value.trim() && results.length > 0 && (
            <li className="px-3 pt-1.5 pb-1 text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">Quoted most lately</li>
          )}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left"
                style={{ background: i === highlight ? "var(--kb-tint-blue)" : undefined }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--kb-text)]"><Highlight text={p.name} query={value} /></span>
                  <span className="block truncate text-[11px] text-[var(--kb-text-dim)]">
                    {[p.sku ? `SKU ${p.sku}` : null, p.description].filter(Boolean).join(" · ") || p.category || " "}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums text-[var(--kb-text)]">{money(p.unitPriceCents)}{p.unit ? <span className="text-[11px] text-[var(--kb-text-dim)]"> /{p.unit}</span> : null}</span>
                  {p.stockQty !== null && (
                    <span className="block text-[11px] tabular-nums" style={{ color: p.stockQty <= 0 ? "var(--kb-tint-peach-ink)" : "var(--kb-text-dim)" }}>
                      {p.stockQty <= 0 ? "out of stock" : `${p.stockQty} in stock`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {!loading && value.trim() && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--kb-text-dim)]">Nothing in the catalogue matches. It will go on as a new item.</li>
          )}
          {value.trim() && results.length > 0 && !exact && (
            <li className="border-t border-[var(--kb-panel-border)] px-3 py-1.5 text-[11px] text-[var(--kb-text-dim)]">
              Or keep typing — “{value.trim()}” goes on as a new item.
            </li>
          )}
        </ul>
      )}

      {editing && (
        <EditProductDialog
          tenantId={tenantId}
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setLastPicked(p);
            setEditing(null);
            onEdited?.(p);
          }}
        />
      )}
    </div>
  );
}

export function EditProductDialog({
  tenantId,
  product,
  onClose,
  onSaved,
}: {
  tenantId: string;
  product: CatalogProduct;
  onClose: () => void;
  onSaved: (p: CatalogProduct) => void;
}) {
  // Rendered into document.body, not where it is used: it is opened from
  // inside the quote's <form>, and a form inside a form is invalid HTML that
  // React refuses to hydrate — and one Enter away from submitting the quote.
  // So no <form> here at all; Save and Enter call save() directly.
  const panelRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function save() {
    const panel = panelRef.current;
    if (!panel) return;
    const val = (n: string) => (panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name=${n}]`)?.value ?? "").trim();
    if (!val("name")) {
      setError("A product needs a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/${tenantId}/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: val("name"),
          description: val("description") || null,
          sku: val("sku") || null,
          unit: val("unit") || null,
          priceRand: val("priceRand"),
          costRand: val("costRand"),
          taxRatePercent: val("taxRatePercent"),
        }),
      });
      const data = (await res.json()) as { product?: CatalogProduct; error?: string };
      if (!res.ok || !data.product) throw new Error(data.error ?? "Could not save.");
      onSaved(data.product);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setSaving(false);
    }
  }

  const field = "kb-input mt-1 w-full text-sm";
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      void save();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${product.name}`}
        onKeyDown={onEnter}
        className="kb-card max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto px-5 py-4 text-[var(--kb-text)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Edit product</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg text-[var(--kb-text-dim)]">×</button>
        </div>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Changes the catalogue from now on, and this line. Documents already sent keep what they were issued with.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs sm:col-span-2">
            <span className="text-[var(--kb-text-dim)]">Name</span>
            <input name="name" defaultValue={product.name} className={field} />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="text-[var(--kb-text-dim)]">Description (printed under the name)</span>
            <textarea name="description" rows={2} defaultValue={product.description ?? ""} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">SKU</span>
            <input name="sku" defaultValue={product.sku ?? ""} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Unit</span>
            <input name="unit" defaultValue={product.unit ?? ""} placeholder="each, m, hours" className={field} />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Price</span>
            <input name="priceRand" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={(product.unitPriceCents / 100).toFixed(2)} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Cost</span>
            <input name="costRand" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={product.costCents !== null ? (product.costCents / 100).toFixed(2) : ""} className={field} />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Tax %</span>
            <input name="taxRatePercent" type="number" step="1" min="0" max="100" defaultValue={product.taxRatePercent ?? ""} className={field} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs" style={{ color: "var(--kb-tint-peach-ink)" }}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="kb-pill kb-pill-ghost text-xs">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="kb-pill kb-pill-primary text-xs disabled:opacity-50">
            {saving ? "Saving…" : "Save product"}
          </button>
        </div>
      </div>
    </div>,
    // Inside the app shell, where the theme's colours and form styles are
    // defined — at the body it rendered with no panel background at all.
    document.querySelector(".kb-shell") ?? document.body
  );
}
