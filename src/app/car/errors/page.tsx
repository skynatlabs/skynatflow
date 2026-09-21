// What is breaking.
//
// Unresolved first, then most recent. A production exception used to be
// invisible unless a customer reported it; this is the page that changes
// that, and it works without an account anywhere.

import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { recentErrors } from "@/lib/errors";
import { markErrorHandledAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ErrorsPage() {
  await requireSuperAdmin();
  const rows = await recentErrors();
  const open = rows.filter((r) => !r.resolvedAt);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Errors</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Server errors, grouped by what broke and where. Names, addresses, phone numbers and record
        ids are stripped before anything is stored, so this never becomes a second copy of a
        customer&apos;s data. Marking one handled hides it until it happens again.
        {process.env.SENTRY_DSN ? " Also forwarded to Sentry." : " Set SENTRY_DSN to forward these to Sentry as well."}
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">Nothing has broken. That is the good outcome.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="kb-card p-4">
              <p className="text-xs text-[var(--kb-text-dim)]">Open</p>
              <p
                className="mt-1 text-xl font-semibold tabular-nums"
                style={{ color: open.length > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
              >
                {open.length}
              </p>
            </div>
            <div className="kb-card p-4">
              <p className="text-xs text-[var(--kb-text-dim)]">Occurrences, all time</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
                {rows.reduce((n, r) => n + r.count, 0).toLocaleString()}
              </p>
            </div>
          </div>

          <ul className="mt-6 grid gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="kb-card p-4"
                style={{ opacity: row.resolvedAt ? 0.5 : 1 }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--kb-text)]">{row.message}</span>
                  <span className="text-xs tabular-nums text-[var(--kb-text-dim)]">
                    {row.count}&times; · last {row.lastSeen.toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-[var(--kb-text-dim)]">
                  {row.method} {row.route} {row.source && `· ${row.source}`}
                </p>
                {!row.resolvedAt && (
                  <form action={markErrorHandledAction} className="mt-2">
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit" className="text-xs text-[var(--kb-text-dim)] underline">
                      Mark handled
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
