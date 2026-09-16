"use client";

// Editing the words.
//
// A contract is a list of clauses in an order that matters, so the editing
// affordances are the ones that order actually needs: add, remove, move up,
// move down. Nothing clever — a rich text editor here would produce a
// document whose formatting the PDF cannot honour, which is worse than plain
// text that prints exactly as typed.

import { useState } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export interface ClauseEditorProps {
  clauses: Array<{ heading: string; body: string }>;
  /** A signed document is the record of what was agreed; it does not change. */
  readOnly: boolean;
}

export function ClauseEditor({ clauses, readOnly }: ClauseEditorProps) {
  const [rows, setRows] = useState(clauses.length > 0 ? clauses : [{ heading: "", body: "" }]);

  const set = (i: number, patch: Partial<{ heading: string; body: string }>) =>
    setRows((r) => r.map((row, j) => (i === j ? { ...row, ...patch } : row)));

  const move = (i: number, by: number) =>
    setRows((r) => {
      const to = i + by;
      if (to < 0 || to >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[to]] = [copy[to], copy[i]];
      return copy;
    });

  if (readOnly) {
    return (
      <ol className="mt-3 space-y-4">
        {rows.map((c, i) => (
          <li key={`${i}-${c.heading}`}>
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">
              {i + 1}. {c.heading}
            </h3>
            <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{c.body}</p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {rows.map((c, i) => (
        <div key={i} className="rounded-xl border border-[var(--kb-panel-border)] p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--kb-text-dim)]">{i + 1}.</span>
            <input
              name="clauseHeading"
              value={c.heading}
              onChange={(e) => set(i, { heading: e.target.value })}
              placeholder="Heading"
              className="kb-input flex-1 text-sm font-medium"
            />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="kb-pill kb-pill-ghost text-[10px]">
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
              className="kb-pill kb-pill-ghost text-[10px]"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setRows((r) => (r.length === 1 ? r : r.filter((_, j) => j !== i)))}
              className="kb-pill kb-pill-ghost text-[10px]"
            >
              Remove
            </button>
          </div>
          <textarea
            name="clauseBody"
            value={c.body}
            onChange={(e) => set(i, { body: e.target.value })}
            rows={Math.max(3, Math.ceil(c.body.length / 110))}
            placeholder="What this clause says."
            className="kb-input mt-2 w-full text-sm"
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { heading: "", body: "" }])}
          className="kb-pill kb-pill-ghost text-xs"
        >
          Add a clause
        </button>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </div>
    </div>
  );
}
