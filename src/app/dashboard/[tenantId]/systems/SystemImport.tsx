"use client";

// Bringing a system's history across.
//
// The same reading and the same review as setting up — a file is a file,
// whether it came from a bank, a supplier or a till. What is different here
// is that the import is recorded against the system it came from, so the page
// can say what has actually moved and what has not.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IntakeDropZone } from "@/app/onboarding/IntakeDropZone";
import { ProposalReview } from "@/app/onboarding/ProposalReview";
import { emptyProposal, mergeProposals, narrate, type Proposal } from "@/lib/onboarding/proposal";

export interface SystemImportProps {
  tenantId: string;
  systemKey: string;
  systemLabel: string;
  exportPath?: string;
  brings?: string;
  recordImport: (records: number) => Promise<void>;
}

export function SystemImport(props: SystemImportProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<Proposal>(emptyProposal());
  const [saved, setSaved] = useState<string[] | null>(null);

  const anything =
    proposal.products.length + proposal.customers.length + proposal.suppliers.length + proposal.obligations.length > 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="kb-pill kb-pill-primary text-xs">
        Bring the data across
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[var(--kb-panel-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--kb-text)]">From {props.systemLabel}</p>
          {props.exportPath && <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{props.exportPath}</p>}
          {props.brings && <p className="text-xs text-[var(--kb-text-dim)]">{props.brings}</p>}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="kb-pill kb-pill-ghost text-[10px]">
          Close
        </button>
      </div>

      <IntakeDropZone
        tenantId={props.tenantId}
        onRead={(read) => {
          setSaved(null);
          setProposal((current) => mergeProposals(current, read));
        }}
        hint={`Drop the export from ${props.systemLabel} here`}
      />

      {proposal.problems.length > 0 && (
        <ul className="space-y-1">
          {proposal.problems.map((p) => (
            <li key={p} className="text-xs text-[var(--kb-tint-peach-ink)]">
              {p}
            </li>
          ))}
        </ul>
      )}

      {anything && (
        <>
          <div className="kb-card p-4" style={{ background: "var(--kb-tint-blue)" }}>
            <ul className="space-y-0.5">
              {narrate(proposal).map((line) => (
                <li key={line} className="text-sm text-[var(--kb-text)]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <ProposalReview
            key={proposal.documents.map((d) => d.fileName).join("|")}
            tenantId={props.tenantId}
            proposal={proposal}
            sections={["products", "customers", "suppliers"]}
            submitLabel={`Bring these over from ${props.systemLabel}`}
            onApplied={async (lines) => {
              setSaved(lines);
              const moved = proposal.products.length + proposal.customers.length + proposal.suppliers.length;
              setProposal(emptyProposal());
              await props.recordImport(moved);
              router.refresh();
            }}
          />
        </>
      )}

      {saved && (
        <ul className="space-y-0.5">
          {saved.map((line) => (
            <li key={line} className="text-sm text-[var(--kb-text-dim)]">
              · {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
