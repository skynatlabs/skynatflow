"use client";

// What the business sells, from wherever it is written down.
//
// A spreadsheet in whatever columns they keep, a supplier's price list as a
// PDF, or a photograph of the stock book on the counter. The table below is
// what will be saved, and it is editable before it is.

import { useEffect, useState } from "react";
import { IntakeDropZone } from "../../IntakeDropZone";
import { ProposalReview } from "../../ProposalReview";
import { continueAction } from "../../actions";
import { addPending, adoptPending, clearPending } from "../../pending";
import { emptyProposal, narrate, type Proposal } from "@/lib/onboarding/proposal";

export function StockStep({ tenantId, already }: { tenantId: string; already: number }) {
  const [pending, setPending] = useState<Proposal>(emptyProposal());
  const [added, setAdded] = useState<string[] | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is only readable after mount
    setPending(adoptPending(tenantId));
  }, [tenantId]);

  const products = { ...pending, customers: [], suppliers: [], obligations: [] };

  return (
    <div className="space-y-4">
      <IntakeDropZone
        tenantId={tenantId}
        onRead={(read) => setPending(addPending(tenantId, read))}
        hint="Your price list or stock sheet — Excel, CSV, a PDF, or a photograph of it"
        askForWords
      />

      {pending.problems.length > 0 && (
        <ul className="space-y-1">
          {pending.problems.map((p) => (
            <li key={p} className="text-xs text-[var(--kb-tint-peach-ink)]">
              {p}
            </li>
          ))}
        </ul>
      )}

      {products.products.length > 0 && (
        <>
          <div className="kb-card p-4" style={{ background: "var(--kb-tint-blue)" }}>
            <ul className="space-y-0.5">
              {narrate(products).map((line) => (
                <li key={line} className="text-sm text-[var(--kb-text)]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <ProposalReview
            key={products.products.length}
            tenantId={tenantId}
            proposal={products}
            sections={["products"]}
            submitLabel="Add these to my catalogue"
            onApplied={(lines) => {
              setAdded(lines);
              clearPending(tenantId, ["products"]);
              setPending((p) => ({ ...p, products: [] }));
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
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">Bring in another list, or carry on — you can add more any time.</p>
        </div>
      )}

      <form action={continueAction.bind(null, tenantId, "stock")} className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--kb-text-dim)]">
          {already > 0 ? `${already.toLocaleString("en-US")} already in your catalogue.` : "Nothing in your catalogue yet."}
        </span>
        <button type="submit" className="kb-pill kb-pill-primary text-sm">
          {added || already > 0 ? "Next: customers" : "Skip for now"}
        </button>
      </form>
    </div>
  );
}
