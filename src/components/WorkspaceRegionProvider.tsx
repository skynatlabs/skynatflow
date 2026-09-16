"use client";

// The workspace's currency and locale, available to any client component.
//
// Server components fetch this per page and pass it down, which is right. But
// a product picker nested four components deep inside a line-item editor
// inside a quote form cannot reasonably receive a prop through every layer,
// and the alternative — each of them hardcoding a currency — is exactly the
// bug this whole change exists to remove.
//
// So: one provider at the dashboard layout, set from the workspace, and a
// hook that refuses to guess. A component outside the provider gets an error
// rather than a plausible default, because a plausible default is how sixty
// call sites came to say rands.

import { createContext, useContext, type ReactNode } from "react";
import { formatMoney } from "@/lib/format/money";

interface WorkspaceRegionValue {
  currency: string;
  locale: string;
  /** How this country writes 03/04/2026. */
  dateOrder: "dmy" | "mdy" | "ymd";
}

const WorkspaceRegionContext = createContext<WorkspaceRegionValue | null>(null);

export function WorkspaceRegionProvider({
  currency,
  locale,
  dateOrder,
  children,
}: WorkspaceRegionValue & { children: ReactNode }) {
  return (
    <WorkspaceRegionContext.Provider value={{ currency, locale, dateOrder }}>
      {children}
    </WorkspaceRegionContext.Provider>
  );
}

export function useWorkspaceRegion(): WorkspaceRegionValue {
  const value = useContext(WorkspaceRegionContext);
  if (!value) {
    // Deliberately loud. A silent fallback here would re-create the exact
    // problem this replaced: a figure formatted in somebody else's money,
    // looking perfectly correct, in front of a customer.
    throw new Error("useWorkspaceRegion was called outside a WorkspaceRegionProvider — wrap the tree in one so figures know whose money they are.");
  }
  return value;
}

/** Money in this workspace's own currency. The only formatter a client component should reach for. */
export function useMoney(): (cents: number, opts?: { decimals?: boolean }) => string {
  const { currency } = useWorkspaceRegion();
  return (cents, opts) => formatMoney(cents, currency, opts);
}
