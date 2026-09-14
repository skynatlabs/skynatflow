"use client";

// Reading an obligation out of the business's own paperwork.
//
// This is the path that makes the feature work in a country nobody here has
// heard of. A trading licence states what it is called, who issued it and
// when it expires — which beats any list we could have written in advance,
// and is the only honest answer for a jurisdiction the library does not
// cover yet.
//
// Text is extracted in the browser rather than uploaded raw so that a plain
// .txt or pasted block needs no server-side parsing at all, and so a file the
// user picked by mistake never leaves their machine.

import { useState, useTransition } from "react";
import { readDocumentAction } from "./actions";

interface Outcome {
  ok: boolean;
  message: string;
  title?: string;
  dueOn?: string;
  needsRealDate?: boolean;
  helpedOthers?: boolean;
}

export function DocumentIntake({ tenantId }: { tenantId: string }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setOutcome(null);
    try {
      // Text formats only, deliberately. Pretending to have read a scanned
      // PDF would be worse than saying we cannot.
      const content = await file.text();
      setText(content.slice(0, 40_000));
    } catch {
      setOutcome({
        ok: false,
        message: "Couldn't read that file. Paste the text instead — a few lines is enough.",
      });
    }
  }

  function submit() {
    startTransition(async () => {
      const result = await readDocumentAction({ tenantId, text, fileName });
      setOutcome(result);
      if (result.ok) {
        setText("");
        setFileName(null);
      }
    });
  }

  return (
    <div className="kb-card px-5 py-5">
      <h2 className="text-base font-semibold text-[var(--kb-text)]">
        Or read it off your own paperwork
      </h2>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Drop in a licence, certificate, permit or policy. We&apos;ll name it the way the document
        names it, take the expiry date from it, and put it on the calendar — wherever in the world
        it was issued.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="block text-xs text-[var(--kb-text-dim)]">
            A text file, or paste the wording below
          </span>
          <input
            type="file"
            accept=".txt,.md,.csv,.json,text/plain"
            onChange={onFile}
            className="mt-1 block w-full text-xs text-[var(--kb-text-dim)] file:mr-3 file:rounded file:border-0 file:bg-[var(--kb-panel-border)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--kb-text)]"
          />
        </label>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Paste the certificate or licence wording here — the name, who issued it, and the expiry date are what matter."
          className="kb-input w-full text-sm"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || text.trim().length < 40}
            className="kb-pill kb-pill-primary text-xs disabled:opacity-50"
          >
            {pending ? "Reading…" : "Read it"}
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
            {outcome.ok && outcome.needsRealDate && (
              <p className="mt-1 opacity-90">
                It didn&apos;t state an expiry, so we put a placeholder a year out — set the real
                date on the tile.
              </p>
            )}
            {outcome.ok && outcome.helpedOthers && (
              <p className="mt-1 opacity-90">
                This also taught us what that document is called where you are, so the next
                business from there gets offered it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
