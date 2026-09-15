"use client";

// The first screen after signing up.
//
// It asks for two things — what the business is called and what it does — and
// offers to read both off something the owner already has. A registration
// certificate, an old invoice or a website answers them, and everything else
// that came with it (the VAT number, the bank account, the customers, the
// price list) is carried through to the steps that ask about it.

import { useState } from "react";
import { IntakeDropZone } from "./IntakeDropZone";
import { startWorkspaceAction } from "./actions";
import { stashBeforeWorkspace } from "./pending";
import { mergeProposals, narrate, emptyProposal, type Proposal } from "@/lib/onboarding/proposal";

export interface NicheOption {
  skin: string;
  label: string;
  tagline: string;
}

export function BusinessStep({ niches }: { niches: NicheOption[] }) {
  const [proposal, setProposal] = useState<Proposal>(emptyProposal());
  const [name, setName] = useState("");
  const [niche, setNiche] = useState(niches[0]?.skin ?? "SERVICES");
  const [submitting, setSubmitting] = useState(false);
  const heard = proposal.documents.length > 0;

  function absorb(read: Proposal) {
    const merged = mergeProposals(proposal, read);
    setProposal(merged);
    if (!name.trim() && merged.business.name?.value) setName(merged.business.name.value);
    if (merged.suggestedNiche && niches.some((n) => n.skin === merged.suggestedNiche!.value)) {
      setNiche(merged.suggestedNiche.value);
    }
  }

  return (
    <div className="space-y-4">
      <IntakeDropZone
        onRead={absorb}
        hint="Start with something you already have"
        askForWebsite
        askForWords
      />

      {heard && (
        <div className="kb-card p-4" style={{ background: "var(--kb-tint-blue)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What I found</p>
          <ul className="mt-1 space-y-0.5">
            {narrate(proposal).map((line) => (
              <li key={line} className="text-sm text-[var(--kb-text)]">
                {line}
              </li>
            ))}
          </ul>
          {proposal.problems.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {proposal.problems.map((p) => (
                <li key={p} className="text-xs text-[var(--kb-text-dim)]">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form
        action={startWorkspaceAction}
        onSubmit={() => {
          setSubmitting(true);
          // What the next steps still have to ask about — the price list, the
          // customers on the invoice — travels with the browser.
          stashBeforeWorkspace(proposal);
        }}
        className="kb-card space-y-4 p-5"
      >
        <input type="hidden" name="proposalJson" value={JSON.stringify({ ...proposal, products: [], customers: [], suppliers: [], obligations: [] })} />
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]" htmlFor="businessName">
            What is the business called?
          </label>
          <input
            id="businessName"
            name="businessName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Ndlovu Logistics"
            className="kb-input mt-1 w-full"
          />
          {proposal.business.name && (
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Read off {proposal.business.name.source}.</p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--kb-text)]">What kind of work is it?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {niches.map((n) => (
              <label
                key={n.skin}
                className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs transition"
                style={{
                  borderColor: niche === n.skin ? "var(--kb-accent-a)" : "var(--kb-panel-border)",
                  background: niche === n.skin ? "var(--kb-tint-violet)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="niche"
                  value={n.skin}
                  checked={niche === n.skin}
                  onChange={() => setNiche(n.skin)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold text-[var(--kb-text)]">{n.label}</span>
                  <span className="block text-[var(--kb-text-dim)]">{n.tagline}</span>
                </span>
              </label>
            ))}
          </div>
          {proposal.suggestedNiche && (
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Picked from {proposal.suggestedNiche.source} — change it if it is wrong.</p>
          )}
        </fieldset>

        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]" htmlFor="ownerPhone">
            WhatsApp number <span className="font-normal text-[var(--kb-text-dim)]">— optional, for your morning briefing</span>
          </label>
          <input id="ownerPhone" name="ownerPhone" inputMode="tel" placeholder="+27 82 123 4567" className="kb-input mt-1 w-full" />
        </div>

        <button type="submit" disabled={submitting || !name.trim()} className="kb-pill kb-pill-primary w-full justify-center py-3">
          {submitting ? "Setting up…" : "Start the workspace"}
        </button>
      </form>
    </div>
  );
}
