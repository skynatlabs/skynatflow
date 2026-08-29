"use client";

import { useRef, useState } from "react";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

// Only visible when Proposal is selected. The AI call only ever fills
// these text fields from the form's own current values (customer name,
// item, quantity, location) — it never designs anything, so this is a
// single fast text-generation call, not a document render.
//
// Textareas are uncontrolled (defaultValue + refs), not React state —
// TemplatePicker.tsx already fills introText/scopeOfWork by mutating the
// DOM node directly (`el.value = ...`), and mixing that with React-
// controlled inputs would fight each other. Both mechanisms write to the
// same plain textareas here, no conflict.
export function ProposalAiPanel({
  tenantId,
  usageRemaining,
  usageLimit,
  defaultIntroText,
  defaultScopeOfWork,
}: {
  tenantId: string;
  usageRemaining: number;
  usageLimit: number;
  defaultIntroText?: string;
  defaultScopeOfWork?: string;
}) {
  const introRef = useRef<HTMLTextAreaElement>(null);
  const scopeRef = useRef<HTMLTextAreaElement>(null);
  const systemInfoRef = useRef<HTMLTextAreaElement>(null);
  const performanceRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(usageRemaining);
  const rootRef = useRef<HTMLDivElement>(null);

  async function handleGenerate() {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const data = new FormData(form);
    const customerName = String(data.get("customerName") ?? "").trim();
    const projectLocation = String(data.get("projectLocation") ?? "").trim();
    const itemName = String(data.get("itemName") ?? "").trim();
    const quantity = String(data.get("quantity") ?? "1");

    if (!customerName || !projectLocation || !itemName) {
      setError("Fill in customer name, item, and project location first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, customerName, projectLocation, itemName, quantity }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generation failed");
      if (introRef.current) introRef.current.value = json.introText;
      if (scopeRef.current) scopeRef.current.value = json.scopeOfWork;
      if (systemInfoRef.current) systemInfoRef.current.value = json.systemInfo;
      if (performanceRef.current) performanceRef.current.value = json.performanceExpectancy;
      if (timelineRef.current) timelineRef.current.value = json.projectTimeline;
      setRemaining(Math.max(0, json.usage.limit - json.usage.used));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={rootRef} className="space-y-4 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] p-4">
      <div>
        <label className={labelClass}>Project location</label>
        <input name="projectLocation" placeholder="e.g. 12 Oak Street, Sandton" className={inputClass} />
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || remaining <= 0}
          className="kb-pill kb-pill-primary text-xs disabled:opacity-50"
        >
          {loading ? "Generating…" : "✨ Generate with AI"}
        </button>
        <span className="text-xs text-[var(--kb-text-dim)]">
          {remaining}/{usageLimit} AI proposals left this month
        </span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div>
        <label className={labelClass}>Intro</label>
        <textarea ref={introRef} name="introText" rows={3} defaultValue={defaultIntroText ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Scope of work</label>
        <textarea ref={scopeRef} name="scopeOfWork" rows={3} defaultValue={defaultScopeOfWork ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>System / equipment info</label>
        <textarea ref={systemInfoRef} name="systemInfo" rows={2} defaultValue="" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Expected performance</label>
        <textarea ref={performanceRef} name="performanceExpectancy" rows={2} defaultValue="" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Project timeline</label>
        <textarea ref={timelineRef} name="projectTimeline" rows={3} defaultValue="" className={inputClass} />
      </div>
    </div>
  );
}
