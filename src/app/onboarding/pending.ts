"use client";

// What was read on one step and has not been confirmed yet, carried to the
// step that asks about it.
//
// Products found on the invoice handed over at the first screen belong on the
// "what you sell" step, not on the screen that asked for the business name.
// This holds them in the browser between the two — never anything already
// saved, so losing it costs nothing but a second look at the same file.

import { emptyProposal, mergeProposals, type Proposal } from "@/lib/onboarding/proposal";

const key = (tenantId: string) => `skynat.intake.${tenantId}`;
/** Where the first screen leaves things: the workspace has no id yet. */
const BEFORE_KEY = "skynat.intake.pending";

export function stashBeforeWorkspace(proposal: Proposal) {
  try {
    sessionStorage.setItem(BEFORE_KEY, JSON.stringify(proposal));
  } catch {
    // Storage turned off: the next step asks for the file again.
  }
}

/** Claim whatever the first screen read, now that the workspace has an id. */
export function adoptPending(tenantId: string): Proposal {
  try {
    const before = sessionStorage.getItem(BEFORE_KEY);
    if (before) {
      sessionStorage.removeItem(BEFORE_KEY);
      const merged = mergeProposals(takePending(tenantId), JSON.parse(before) as Proposal);
      stashPending(tenantId, merged);
      return merged;
    }
  } catch {
    // Nothing waiting, or nowhere to keep it.
  }
  return takePending(tenantId);
}

export function stashPending(tenantId: string, proposal: Proposal) {
  try {
    sessionStorage.setItem(key(tenantId), JSON.stringify(proposal));
  } catch {
    // A browser with storage turned off simply asks for the file again.
  }
}

export function takePending(tenantId: string): Proposal {
  try {
    const raw = sessionStorage.getItem(key(tenantId));
    return raw ? (JSON.parse(raw) as Proposal) : emptyProposal();
  } catch {
    return emptyProposal();
  }
}

/** Fold a fresh reading into whatever is already waiting. */
export function addPending(tenantId: string, proposal: Proposal): Proposal {
  const merged = mergeProposals(takePending(tenantId), proposal);
  stashPending(tenantId, merged);
  return merged;
}

/** Once a step has written its part down, it stops waiting. */
export function clearPending(tenantId: string, parts: Array<keyof Proposal>) {
  const current = takePending(tenantId);
  for (const part of parts) {
    if (Array.isArray(current[part])) (current[part] as unknown[]) = [];
    else if (part === "business" || part === "banking") (current[part] as object) = {};
  }
  stashPending(tenantId, current);
}
