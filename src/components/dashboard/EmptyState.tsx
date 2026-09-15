// A zero state that teaches.
//
// Every empty screen says what it is for, what it needs, and offers the one
// action that fills it. "No data" teaches nobody anything, and an empty
// screen is the moment somebody decides whether a feature is for them.

import Link from "next/link";

export function EmptyState({
  title,
  purpose,
  needs,
  action,
  compact = false,
}: {
  title: string;
  /** What this place is for, in one sentence. */
  purpose: string;
  /** What has to exist for it to fill. */
  needs?: string;
  action?: { label: string; href: string };
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="py-2 text-sm">
        <p className="text-[var(--kb-text)]">{title}</p>
        <p className="text-xs text-[var(--kb-text-dim)]">{purpose}{needs ? ` ${needs}` : ""}</p>
        {action && <Link href={action.href} className="mt-1 inline-block text-xs font-medium underline">{action.label}</Link>}
      </div>
    );
  }
  return (
    <div className="kb-card px-6 py-10 text-center">
      <h3 className="font-semibold text-[var(--kb-text)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--kb-text-dim)]">{purpose}</p>
      {needs && <p className="mx-auto mt-1 max-w-md text-xs text-[var(--kb-text-dim)]">{needs}</p>}
      {action && (
        <Link href={action.href} className="kb-pill kb-pill-primary mt-4 inline-flex text-xs">{action.label}</Link>
      )}
    </div>
  );
}
