"use client";

import { useState } from "react";
import { parseCsv, IMPORT_PRESETS, TARGET_FIELDS, guessMapping } from "@/lib/import/csv";
import { importRecordsAction, type ImportResult } from "./actions";

type Target = keyof typeof TARGET_FIELDS;

export function ImportClient({ tenantId }: { tenantId: string }) {
  const [target, setTarget] = useState<Target>("customers");
  const [preset, setPreset] = useState("generic");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);

    const presetConfig = IMPORT_PRESETS[preset]?.[target];
    setMapping(guessMapping(parsed.headers, presetConfig));
  }

  function applyPreset(nextPreset: string) {
    setPreset(nextPreset);
    const presetConfig = IMPORT_PRESETS[nextPreset]?.[target];
    if (headers.length) setMapping(guessMapping(headers, presetConfig));
  }

  function mappedRecords(): Record<string, string>[] {
    const fields = TARGET_FIELDS[target];
    return rows.map((row) => {
      const record: Record<string, string> = {};
      for (const f of fields) {
        const col = mapping[f.key];
        const idx = col ? headers.indexOf(col) : -1;
        record[f.key] = idx >= 0 ? (row[idx] ?? "") : "";
      }
      return record;
    });
  }

  async function handleCommit() {
    setSubmitting(true);
    setResult(null);
    try {
      const records = mappedRecords();
      const res = await importRecordsAction(tenantId, target, records);
      setResult(res);
    } finally {
      setSubmitting(false);
    }
  }

  const fields = TARGET_FIELDS[target];
  const requiredMissing = fields.some((f) => f.required && !mapping[f.key]);
  const preview = mappedRecords().slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="kb-card p-6">
        <label className="block text-sm font-medium text-[var(--kb-text)]">Importing</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["customers", "products", "quotes", "invoices"] as Target[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTarget(t);
                if (headers.length) setMapping(guessMapping(headers, IMPORT_PRESETS[preset]?.[t]));
              }}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition ${
                target === t
                  ? "border-[var(--kb-accent-a)] text-[var(--kb-text)]"
                  : "border-[var(--kb-panel-border)] text-[var(--kb-text-dim)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-[var(--kb-text)]">
          Exported from
        </label>
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
        >
          {Object.entries(IMPORT_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium text-[var(--kb-text)]">CSV file</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="mt-1 w-full text-sm text-[var(--kb-text-dim)]"
        />
        {fileName && (
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            {fileName} — {rows.length} rows detected
          </p>
        )}
      </div>

      {headers.length > 0 && (
        <div className="kb-card p-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">Map columns</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Pre-filled from the preset where possible — check it matches your file.
          </p>
          <div className="mt-3 space-y-3">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="w-40 shrink-0 text-sm text-[var(--kb-text)]">
                  {f.label}
                  {f.required && <span className="text-[var(--kb-tint-peach-ink)]"> *</span>}
                </label>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="flex-1 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)]"
                >
                  <option value="">— not mapped —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.length > 0 && (
        <div className="kb-card p-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">
            Preview — first {preview.length} of {rows.length}
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-xs uppercase text-[var(--kb-text-dim)]">
                  {fields.map((f) => (
                    <th key={f.key} className="py-2 pr-4 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    {fields.map((f) => (
                      <td key={f.key} className="py-2 pr-4 text-[var(--kb-text)]">
                        {r[f.key] || <span className="text-[var(--kb-text-dim)]">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={handleCommit}
            disabled={requiredMissing || submitting}
            className="kb-pill kb-pill-primary mt-5 w-full justify-center py-3 disabled:opacity-50"
          >
            {submitting ? "Importing…" : `Import ${rows.length} rows`}
          </button>
          {requiredMissing && (
            <p className="mt-2 text-xs text-[var(--kb-tint-peach-ink)]">
              Map every required field (*) before importing.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="kb-card p-6">
          <p className="text-sm font-semibold text-[var(--kb-text)]">
            Imported {result.imported} · Skipped {result.skipped}
            {result.errors.length > 0 && ` · ${result.errors.length} errors`}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-[var(--kb-tint-peach-ink)]">
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
