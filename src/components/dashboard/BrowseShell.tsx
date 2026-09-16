"use client";

// Two panels on a desk, one layer on a phone.
//
// Quotes and invoices used a fixed 320px list beside a flexible detail, at
// every width. On a desk that is the right shape and the one every invoicing
// tool uses. On a 375px phone it left about fifty pixels for the document —
// so the detail was technically rendered and effectively invisible, which is
// the worst of both.
//
// The fix is not a narrower list. A phone has room for one thing, so it shows
// one thing: the list, until somebody taps a row, and then the document with
// a way back. Nothing is hidden and nothing is duplicated — the same two
// children render either way, and only which of them is on screen changes.
//
// Done here rather than in the layout because the layout is a server
// component and cannot see which document is open; the pathname can.

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

export function BrowseShell({
  basePath,
  listLabel,
  list,
  children,
}: {
  /** The list's own route, e.g. /dashboard/abc/quotes. */
  basePath: string;
  /** What the back link says: "All quotes", "All invoices". */
  listLabel: string;
  list: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // Anything below the base path is a document. The index itself is the
  // overview, which on a phone is simply the list — there is no room for a
  // chart nobody asked for above a list they came here to read.
  const showingDocument = pathname !== basePath && pathname.startsWith(basePath);

  return (
    <div className="flex h-[100dvh] flex-col md:flex-row">
      {/* The list. Full width on a phone, a fixed column on a desk, and
          hidden on a phone once a document is open. */}
      <div
        className={`${showingDocument ? "hidden md:flex" : "flex"} h-full w-full flex-col border-b border-[var(--kb-panel-border)] md:w-80 md:shrink-0 md:border-b-0 md:border-r`}
      >
        {list}
      </div>

      {/* The document. Hidden on a phone until one is chosen, because the
          overview behind it is a desk view and a phone has no room for it. */}
      <div className={`${showingDocument ? "flex" : "hidden md:flex"} h-full min-w-0 flex-1 flex-col overflow-y-auto`}>
        {showingDocument && (
          // Only on a phone: on a desk the list is still visible beside it,
          // so a back link would be pointing at something already on screen.
          <div className="sticky top-0 z-10 border-b border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-4 py-2.5 md:hidden">
            <Link href={basePath} className="text-sm text-[var(--kb-text-dim)]">
              &larr; {listLabel}
            </Link>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
