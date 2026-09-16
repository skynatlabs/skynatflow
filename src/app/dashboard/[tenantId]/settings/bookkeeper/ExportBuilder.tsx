"use client";

// Build the file, read what it left out, then download it.
//
// The notes are shown before the download rather than after, because "14
// costs are not coded to an account" is something an owner can still do
// something about while they are sitting here, and is useless once the file
// is already in their accountant's inbox.

import { useState } from "react";
import type { PackageDef } from "@/lib/export/accounting";

type Built = { fileName: string; csv: string; rows: number; notes: string[] };

export function ExportBuilder({
  tenantId,
  packages,
  defaultFrom,
  defaultTo,
  buildAction,
}: {
  tenantId: string;
  packages: PackageDef[];
  defaultFrom: string;
  defaultTo: string;
  buildAction: (formData: FormData) => Promise<Built>;
}) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function download() {
    if (!built) return;
    // A BOM, because Excel opens a UTF-8 CSV as mojibake without one and the
    // first thing most of these files meet is Excel.
    const blob = new Blob(["﻿", built.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = built.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <form
        action={async (formData) => {
          setBusy(true);
          setError(null);
          setBuilt(null);
          try {
            setBuilt(await buildAction(formData));
          } catch (e) {
            setError(e instanceof Error ? e.message : "That did not build.");
          } finally {
            setBusy(false);
          }
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="tenantId" value={tenantId} />

        <label className="text-xs text-[var(--kb-text-dim)]">
          What
          <select
            name="what"
            className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
          >
            <option value="invoices">Invoices</option>
            <option value="costs">Costs and slips</option>
            <option value="trial-balance">Trial balance</option>
          </select>
        </label>

        <label className="text-xs text-[var(--kb-text-dim)]">
          Their software
          <select
            name="package"
            className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
          >
            {packages.map((pkg) => (
              <option key={pkg.key} value={pkg.key}>
                {pkg.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--kb-text-dim)]">
          From
          <input
            type="date"
            name="from"
            defaultValue={defaultFrom}
            className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
          />
        </label>

        <label className="text-xs text-[var(--kb-text-dim)]">
          To
          <input
            type="date"
            name="to"
            defaultValue={defaultTo}
            className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
          />
        </label>

        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="kb-pill kb-pill-primary text-xs disabled:opacity-50">
            {busy ? "Building…" : "Build the file"}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-xs text-[var(--kb-tint-rose-ink)]">{error}</p>}

      {built && (
        <div className="mt-4 rounded-xl border border-[var(--kb-panel-border)] p-3">
          <p className="text-sm text-[var(--kb-text)]">
            {built.rows.toLocaleString()} {built.rows === 1 ? "row" : "rows"} · {built.fileName}
          </p>
          <ul className="mt-2 grid gap-1 text-xs text-[var(--kb-text-dim)]">
            {built.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <button type="button" onClick={download} disabled={built.rows === 0} className="kb-pill kb-pill-primary mt-3 text-xs disabled:opacity-50">
            {built.rows === 0 ? "Nothing to download" : "Download"}
          </button>
        </div>
      )}
    </div>
  );
}
