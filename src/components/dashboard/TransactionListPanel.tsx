"use client";

// The persistent left-hand list for /quotes and /invoices — stays mounted
// while the right-hand detail panel swaps between the empty state and a
// specific record, the same two-column pattern most invoicing tools use.
// Fetches its own page client-side (App Router layouts can't read
// searchParams, and this needs to update without losing the selection).

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusPill } from "./StatusPill";

interface Row {
  id: string;
  partyName: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export function TransactionListPanel({
  tenantId,
  type,
  basePath,
}: {
  tenantId: string;
  type: "QUOTE" | "INVOICE";
  basePath: string;
}) {
  const pathname = usePathname();
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounce the search box — fetching on every keystroke hammers the API
  // for no benefit once someone's mid-word; 300ms is short enough to still
  // feel instant once they pause.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    // `cancelled` guards against an out-of-order response: paging or typing
    // quickly fires several overlapping requests, and without this an
    // earlier one resolving last would overwrite the newest results with
    // stale rows. Only the most recent effect run is allowed to commit.
    let cancelled = false;
    // deliberate: this drives the loading state for the fetch below, which is
    // exactly the external-system sync an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams({ type, page: String(page) });
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    fetch(`/api/dashboard/${tenantId}/transactions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRows(data.items);
        setPageCount(data.pageCount);
        setTotal(data.total);
      })
      .catch(() => {
        // A failed list fetch shouldn't leave the panel spinning forever.
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, type, page, debouncedQ]);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-[var(--kb-panel-border)]">
      <div className="border-b border-[var(--kb-panel-border)] p-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by customer…"
          className="w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-1.5 text-sm text-[var(--kb-text)]"
        />
        <p className="mt-1.5 text-xs text-[var(--kb-text-dim)]">{total} total</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-4 text-xs text-[var(--kb-text-dim)]">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-4 text-xs text-[var(--kb-text-dim)]">Nothing here yet.</p>
        )}
        {rows.map((row) => {
          const href = `${basePath}/${row.id}`;
          const isActive = pathname === href;
          return (
            <Link
              key={row.id}
              href={href}
              className={`block border-b border-[var(--kb-panel-border)] px-4 py-3 text-sm hover:bg-black/[0.02] ${
                isActive ? "bg-[var(--kb-panel)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-[var(--kb-text)]">{row.partyName}</span>
                <span className="shrink-0 text-[var(--kb-text)]">{money(row.amountCents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <StatusPill status={row.status} />
                <span className="text-[var(--kb-text-dim)]">
                  {new Date(row.createdAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--kb-panel-border)] p-3 text-xs">
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
