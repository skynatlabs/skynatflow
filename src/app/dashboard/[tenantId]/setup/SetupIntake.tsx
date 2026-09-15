"use client";

// The drop zone and the review, inside the workspace rather than the wizard.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IntakeDropZone } from "@/app/onboarding/IntakeDropZone";
import { ProposalReview } from "@/app/onboarding/ProposalReview";
import { emptyProposal, mergeProposals, narrate, type Proposal } from "@/lib/onboarding/proposal";

export function SetupIntake({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [proposal, setProposal] = useState<Proposal>(emptyProposal());
  const [saved, setSaved] = useState<string[] | null>(null);
  const anything =
    proposal.products.length +
      proposal.customers.length +
      proposal.suppliers.length +
      proposal.obligations.length +
      Object.keys(proposal.business).length +
      Object.keys(proposal.banking).length >
    0;

  return (
    <div className="space-y-4">
      <IntakeDropZone
        tenantId={tenantId}
        onRead={(read) => {
          setSaved(null);
          setProposal((current) => mergeProposals(current, read));
        }}
        hint="Drop anything in"
        askForWords
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
            tenantId={tenantId}
            proposal={proposal}
            sections={["business", "banking", "certificates", "products", "customers", "suppliers"]}
            submitLabel="Save these"
            onApplied={(lines) => {
              setSaved(lines);
              setProposal(emptyProposal());
              router.refresh();
            }}
          />
        </>
      )}

      {saved && (
        <div className="kb-card p-4">
          <ul className="space-y-0.5">
            {saved.map((line) => (
              <li key={line} className="text-sm text-[var(--kb-text-dim)]">
                · {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
