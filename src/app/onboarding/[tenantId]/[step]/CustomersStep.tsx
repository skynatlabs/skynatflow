"use client";

// Who the business sells to, and what they already owe.
//
// Two different things, deliberately side by side: the contact list, which
// most businesses have somewhere, and the history from whatever they invoiced
// on before — because a balance brought across is what makes the first
// morning's brief real rather than a blank page.

import { useEffect, useState } from "react";
import { IntakeDropZone } from "../../IntakeDropZone";
import { ProposalReview } from "../../ProposalReview";
import { continueAction } from "../../actions";
import { addPending, adoptPending, clearPending } from "../../pending";
import { ImportClient } from "@/app/dashboard/[tenantId]/settings/import/ImportClient";
import { emptyProposal, narrate, type Proposal } from "@/lib/onboarding/proposal";

export function CustomersStep({ tenantId, already }: { tenantId: string; already: number }) {
  const [pending, setPending] = useState<Proposal>(emptyProposal());
  const [added, setAdded] = useState<string[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is only readable after mount
    setPending(adoptPending(tenantId));
  }, [tenantId]);

  const people = { ...pending, products: [], obligations: [] };
  const found = people.customers.length + people.suppliers.length;

  return (
    <div className="space-y-4">
      <IntakeDropZone
        tenantId={tenantId}
        onRead={(read) => setPending(addPending(tenantId, read))}
        hint="Your contact list, or a few of last month's invoices"
        askForWords
      />

      {found > 0 && (
        <>
          <div className="kb-card p-4" style={{ background: "var(--kb-tint-blue)" }}>
            <ul className="space-y-0.5">
              {narrate(people).map((line) => (
                <li key={line} className="text-sm text-[var(--kb-text)]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <ProposalReview
            key={found}
            tenantId={tenantId}
            proposal={people}
            sections={["customers", "suppliers"]}
            submitLabel="Add these people"
            onApplied={(lines) => {
              setAdded(lines);
              clearPending(tenantId, ["customers", "suppliers"]);
              setPending((p) => ({ ...p, customers: [], suppliers: [] }));
            }}
          />
        </>
      )}

      {added && (
        <div className="kb-card p-4">
          <ul className="space-y-0.5">
            {added.map((line) => (
              <li key={line} className="text-sm text-[var(--kb-text-dim)]">
                · {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="kb-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Bring your history across</h2>
            <p className="mt-0.5 max-w-prose text-xs text-[var(--kb-text-dim)]">
              Quoting from Zoho, QuickBooks, Sage or a spreadsheet until now? Bring the quotes and invoices over with their dates and
              their status, so what is owed to you is right from the first day.
            </p>
          </div>
          <button type="button" onClick={() => setShowHistory(!showHistory)} className="kb-pill kb-pill-ghost text-xs">
            {showHistory ? "Hide" : "Bring it over"}
          </button>
        </div>
        {showHistory && (
          <div className="mt-4">
            <ImportClient tenantId={tenantId} />
          </div>
        )}
      </div>

      <form action={continueAction.bind(null, tenantId, "customers")} className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--kb-text-dim)]">
          {already > 0 ? `${already.toLocaleString("en-US")} already on file.` : "Nobody on file yet."}
        </span>
        <button type="submit" className="kb-pill kb-pill-primary text-sm">
          {added || already > 0 ? "Next: your look" : "Skip for now"}
        </button>
      </form>
    </div>
  );
}
