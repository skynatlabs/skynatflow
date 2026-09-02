"use client";

// Tile grid + debounced search + pagination for /car/tenants — replaces
// the old flat divided-list with the same "blocks not lists" treatment
// used across the tenant dashboard, backed by /api/car/tenants.

import { useEffect, useState } from "react";

interface Row {
  id: string;
  name: string;
  niche: string;
  owner: string;
  memberCount: number;
  createdAt: string;
}

export function TenantListClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    fetch(`/api/car/tenants?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.items);
        setPageCount(data.pageCount);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page, debouncedQ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search tenants by name…"
          className="w-full max-w-xs rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
        />
        <p className="shrink-0 text-xs text-[var(--kb-text-dim)]">{total} total</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <div key={t.id} className="kb-tile kb-tint-blue">
            <p className="truncate text-sm font-semibold">{t.name}</p>
            <p className="mt-1 text-xs opacity-70">{t.niche}</p>
            <p className="mt-3 truncate text-xs opacity-70">{t.owner}</p>
            <div className="mt-3 flex items-center justify-between text-xs opacity-70">
              <span>
                {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
              </span>
              <span>{new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <p className="col-span-full p-4 text-sm text-[var(--kb-text-dim)]">No tenants match that search.</p>
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-between text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="kb-pill kb-pill-ghost disabled:opacity-40"
          >
            &larr; Prev
          </button>
          <span className="text-[var(--kb-text-dim)]">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="kb-pill kb-pill-ghost disabled:opacity-40"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
