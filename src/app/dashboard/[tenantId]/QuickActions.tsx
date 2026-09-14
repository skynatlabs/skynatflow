// The handful of things an owner starts a session by doing.
//
// Not a second navigation — the sidebar is already the site map. These are
// the actions with enough daily frequency to be worth a tile, and each one
// carries the live number that tells you whether it needs you today. A
// shortcut with a count on it is a decision; one without is just a link.

import Link from "next/link";

export interface QuickAction {
  href: string;
  label: string;
  hint: string;
  /** Live count; omitted where the action isn't a queue. */
  count?: number;
  tint: "blue" | "yellow" | "peach" | "violet" | "mint";
  primary?: boolean;
}

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {actions.map((a) => (
        <Link
          key={a.href + a.label}
          href={a.href}
          // Primary emphasis is a class, not an inline style, so a skin can
          // answer for it — Admina marks the primary action with a filled
          // button rather than by ringing a card.
          className={`kb-tile kb-tint-${a.tint} group flex min-h-[5.5rem] flex-col justify-between transition-transform hover:-translate-y-0.5${
            a.primary ? " kb-tile-primary" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold leading-snug">{a.label}</span>
            {a.count !== undefined && a.count > 0 && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white"
                style={{ background: "var(--kb-accent-a)" }}
              >
                {a.count > 99 ? "99+" : a.count}
              </span>
            )}
          </div>
          <span className="text-[11px] leading-snug opacity-70">{a.hint}</span>
        </Link>
      ))}
    </div>
  );
}
