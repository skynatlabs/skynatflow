"use client";

// Getting a statement into the app.
//
// The file is read in the browser and the text posted, rather than uploading
// the file itself: a bank statement is about as sensitive as a document gets,
// and a file the person picked by mistake should never leave their machine.

import { useState, useTransition } from "react";
import { importStatementAction } from "./actions";

export function StatementImport({
  tenantId,
  accounts,
}: {
  tenantId: string;
  accounts: Array<{ id: string; name: string; last4: string | null }>;
}) {
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; problems: string[] } | null>(
    null
  );
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setOutcome(null);
    try {
      setCsv(await file.text());
    } catch {
      setOutcome({
        ok: false,
        message: "Couldn't read that file. Try exporting it as CSV.",
        problems: [],
      });
    }
  }

  function submit() {
    start(async () => {
      const result = await importStatementAction({ tenantId, bankAccountId, csv });
      setOutcome(result);
      if (result.ok) {
        setCsv("");
        setFileName(null);
      }
    });
  }

  if (accounts.length === 0) return null;

  return (
    <div className="kb-card px-5 py-5">
      <h2 className="text-base font-semibold text-[var(--kb-text)]">Import a statement</h2>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        A CSV from your bank. Overlapping exports are safe — anything already on file is skipped
        rather than counted twice.
      </p>
      <p className="mt-1.5 text-xs text-[var(--kb-text-dim)]">
        Dates are read day-first (25/12/2026 is December). Rows that can&apos;t be read are listed
        rather than silently dropped.
      </p>

      <div className="mt-4 space-y-3">
        {accounts.length > 1 && (
          <label className="block text-sm">
            <span className="block text-xs text-[var(--kb-text-dim)]">Which account</span>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="kb-input mt-1 w-full text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.last4 ? ` ····${a.last4}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={onFile}
          className="block w-full text-xs text-[var(--kb-text-dim)] file:mr-3 file:rounded file:border-0 file:bg-[var(--kb-panel-border)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--kb-text)]"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || csv.trim().length < 20 || !bankAccountId}
            className="kb-pill kb-pill-primary text-xs disabled:opacity-50"
          >
            {pending ? "Importing…" : "Import"}
          </button>
          {fileName && <span className="text-xs text-[var(--kb-text-dim)]">{fileName}</span>}
        </div>

        {outcome && (
          <div
            className="rounded-md px-3 py-2 text-xs leading-relaxed"
            style={{
              background: outcome.ok ? "var(--kb-tint-mint)" : "var(--kb-tint-peach)",
              color: outcome.ok ? "var(--kb-tint-mint-ink)" : "var(--kb-tint-peach-ink)",
            }}
          >
            <p>{outcome.message}</p>
            {outcome.problems.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 opacity-90">
                {outcome.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
