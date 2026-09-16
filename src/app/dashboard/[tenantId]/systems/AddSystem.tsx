"use client";

// Telling us what you already run.
//
// Asked plainly and without judgement, because the answer is "Sage and a
// spreadsheet" far more often than anyone selling software likes to admit,
// and a business that feels caught out by the question does not answer it
// honestly — which makes everything built on the answer useless.

import { useState } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export interface AddSystemProps {
  options: Array<{ key: string; label: string; category: string; what: string; already: boolean }>;
  categoryLabel: Record<string, string>;
  addAction: (formData: FormData) => Promise<void>;
}

export function AddSystem({ options, categoryLabel, addAction }: AddSystemProps) {
  const [open, setOpen] = useState(false);
  const [systemKey, setSystemKey] = useState("");
  const chosen = options.find((o) => o.key === systemKey);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="kb-pill kb-pill-primary text-xs">
        Add something you use
      </button>
    );
  }

  const byCategory = options.reduce<Record<string, typeof options>>((acc, o) => {
    (acc[o.category] ??= []).push(o);
    return acc;
  }, {});

  return (
    <form action={addAction} className="kb-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">What else do you run?</h2>
        <button type="button" onClick={() => setOpen(false)} className="kb-pill kb-pill-ghost text-[10px]">
          Cancel
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-[var(--kb-text-dim)]">
          The system
          <select
            name="systemKey"
            required
            value={systemKey}
            onChange={(e) => setSystemKey(e.target.value)}
            className="kb-input mt-1 w-full text-sm"
          >
            <option value="">Choose…</option>
            {Object.entries(byCategory).map(([category, list]) => (
              <optgroup key={category} label={categoryLabel[category] ?? category}>
                {list.map((o) => (
                  <option key={o.key} value={o.key} disabled={o.already}>
                    {o.label}
                    {o.already ? " — already on the list" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--kb-text-dim)]">
          Is that still where your records live?
          <select name="isSystemOfRecord" className="kb-input mt-1 w-full text-sm">
            <option value="yes">Yes — it is still the real one</option>
            <option value="no">No — we have moved off it</option>
          </select>
        </label>

        {systemKey === "other" && (
          <label className="text-xs text-[var(--kb-text-dim)] sm:col-span-2">
            What is it called?
            <input name="label" required placeholder="e.g. Kazang, Pilot, an in-house system" className="kb-input mt-1 w-full text-sm" />
          </label>
        )}

        <label className="text-xs text-[var(--kb-text-dim)] sm:col-span-2">
          Anything worth noting (optional)
          <input name="notes" placeholder="e.g. only for VAT, the bookkeeper does it once a quarter" className="kb-input mt-1 w-full text-sm" />
        </label>
      </div>

      {chosen && <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{chosen.what}</p>}

      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText="Adding…">Add it</SubmitButton>
      </div>
    </form>
  );
}
