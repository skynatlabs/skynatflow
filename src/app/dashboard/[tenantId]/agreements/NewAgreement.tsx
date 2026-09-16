"use client";

// Starting one.
//
// Two ways in, side by side, because they suit different moments: pick the
// shape you want from the library and edit it, or say what you need in a
// sentence and have it drafted. Both land in the same editor — nothing here
// sends anything to anybody.

import { useState } from "react";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export interface NewAgreementProps {
  tenantId: string;
  parties: Array<{ id: string; name: string; companyName: string | null }>;
  templates: Array<{ key: string; label: string; purpose: string; wantsValue: boolean; wantsTerm: boolean }>;
  currencySymbol: string;
  aiAvailable: boolean;
  createAction: (formData: FormData) => Promise<void>;
  draftAction: (formData: FormData) => Promise<void>;
}

export function NewAgreement(props: NewAgreementProps) {
  const [mode, setMode] = useState<"template" | "ai" | null>(null);
  const [templateKey, setTemplateKey] = useState(props.templates[0]?.key ?? "proposal");
  const template = props.templates.find((t) => t.key === templateKey);

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("template")} className="kb-pill kb-pill-primary text-xs">
          Start from a template
        </button>
        <button type="button" onClick={() => setMode("ai")} className="kb-pill kb-pill-ghost text-xs">
          Describe it and have it drafted
        </button>
      </div>
    );
  }

  const partyField = (
    <label className="text-xs text-[var(--kb-text-dim)]">
      Who it is with
      <select name="partyId" required className="kb-input mt-1 w-full text-sm">
        <option value="">Choose…</option>
        {props.parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.companyName ?? p.name}
          </option>
        ))}
      </select>
    </label>
  );

  const termsFields = (
    <>
      <label className="text-xs text-[var(--kb-text-dim)]">
        Value ({props.currencySymbol})
        <input name="value" inputMode="decimal" placeholder="4500" className="kb-input mt-1 w-full text-sm" />
      </label>
      <label className="text-xs text-[var(--kb-text-dim)]">
        How often
        <select name="recurrence" className="kb-input mt-1 w-full text-sm">
          <option value="once">Once off</option>
          <option value="monthly">A month</option>
          <option value="quarterly">A quarter</option>
          <option value="annually">A year</option>
        </select>
      </label>
      <label className="text-xs text-[var(--kb-text-dim)]">
        Starts
        <input type="date" name="startsAt" className="kb-input mt-1 w-full text-sm" />
      </label>
      <label className="text-xs text-[var(--kb-text-dim)]">
        Ends
        <input type="date" name="endsAt" className="kb-input mt-1 w-full text-sm" />
      </label>
    </>
  );

  return (
    <form action={mode === "ai" ? props.draftAction : props.createAction} className="kb-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">
          {mode === "ai" ? "Describe what you need" : "Start from a template"}
        </h2>
        <button type="button" onClick={() => setMode(null)} className="kb-pill kb-pill-ghost text-[10px]">
          Cancel
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {partyField}

        {mode === "template" ? (
          <label className="text-xs text-[var(--kb-text-dim)]">
            What kind
            <select
              name="templateKey"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className="kb-input mt-1 w-full text-sm"
            >
              {props.templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-xs text-[var(--kb-text-dim)]">
            Falls back to
            <select name="templateKey" className="kb-input mt-1 w-full text-sm">
              {props.templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {termsFields}

        <label className="text-xs text-[var(--kb-text-dim)]">
          Valid until (a proposal goes stale)
          <input type="date" name="validUntil" className="kb-input mt-1 w-full text-sm" />
        </label>
      </div>

      {mode === "template" && template && (
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{template.purpose}</p>
      )}

      {mode === "ai" && (
        <>
          <textarea
            name="instruction"
            required
            rows={3}
            placeholder="A maintenance contract for their two generators — two service visits a year, four-hour response on a breakdown, parts charged separately, twelve months."
            className="kb-input mt-3 w-full text-sm"
          />
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            {props.aiAvailable
              ? "The value and the dates above are what goes in the document — the drafting only writes the words around them."
              : "Nothing is configured to draft with, so this will start from the template you picked instead."}
          </p>
        </>
      )}

      <div className="mt-3 flex justify-end">
        <SubmitButton pendingText={mode === "ai" ? "Drafting…" : "Creating…"}>
          {mode === "ai" ? "Draft it" : "Create the draft"}
        </SubmitButton>
      </div>
    </form>
  );
}
