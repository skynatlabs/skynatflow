"use client";

import { useState } from "react";
import { ProposalAiPanel } from "./ProposalAiPanel";

const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export function QuoteTypeSection({
  tenantId,
  usageRemaining,
  usageLimit,
  defaultKind,
  defaultIntroText,
  defaultScopeOfWork,
}: {
  tenantId: string;
  usageRemaining: number;
  usageLimit: number;
  defaultKind?: "BASIC" | "PROPOSAL";
  defaultIntroText?: string;
  defaultScopeOfWork?: string;
}) {
  const [kind, setKind] = useState<"BASIC" | "PROPOSAL">(defaultKind ?? "BASIC");

  return (
    <div>
      <label className={labelClass}>Quote type</label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm has-[:checked]:border-[var(--kb-accent-a)]">
          <input
            type="radio"
            name="quoteKind"
            value="BASIC"
            checked={kind === "BASIC"}
            onChange={() => setKind("BASIC")}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-[var(--kb-text)]">Standard</span>
            <span className="block text-xs text-[var(--kb-text-dim)]">Just line items and a total.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm has-[:checked]:border-[var(--kb-accent-a)]">
          <input
            type="radio"
            name="quoteKind"
            value="PROPOSAL"
            checked={kind === "PROPOSAL"}
            onChange={() => setKind("PROPOSAL")}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-[var(--kb-text)]">Proposal</span>
            <span className="block text-xs text-[var(--kb-text-dim)]">
              Project info, AI-generated from your line item.
            </span>
          </span>
        </label>
      </div>

      {kind === "PROPOSAL" && (
        <div className="mt-3">
          <ProposalAiPanel
            tenantId={tenantId}
            usageRemaining={usageRemaining}
            usageLimit={usageLimit}
            defaultIntroText={defaultIntroText}
            defaultScopeOfWork={defaultScopeOfWork}
          />
        </div>
      )}
    </div>
  );
}
