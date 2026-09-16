// The page somebody opens before they phone.
//
// Public and outside the dashboard on purpose: the moment it is most needed
// is the moment signing in might be the thing that is broken. It carries no
// business data of any kind — only whether the parts of the platform are
// answering.

import { status, type Health } from "@/lib/platform/status";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Status — ${BRAND}`,
  description: "Whether the platform is working.",
};

const DOT: Record<Health, string> = {
  working: "var(--kb-tint-mint-ink)",
  slow: "var(--kb-tint-amber-ink)",
  down: "var(--kb-tint-rose-ink)",
  unknown: "var(--kb-text-dim)",
};

const WORD: Record<Health, string> = {
  working: "Working",
  slow: "Slow",
  down: "Down",
  unknown: "Not switched on",
};

export default async function StatusPage() {
  const report = await status();

  return (
    <div className="kb-shell min-h-screen" data-theme="light">
      <main className="mx-auto max-w-2xl p-4 py-12 sm:p-8">
        <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">{BRAND}</p>
        <h1 className="mt-1 text-2xl font-semibold text-balance text-[var(--kb-text)] sm:text-3xl">{report.headline}</h1>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          Checked just now, {report.checkedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}. This page runs
          the checks when you open it — it is never a cached green tick.
        </p>

        <ul className="mt-8 grid gap-3">
          {report.checks.map((check) => (
            <li key={check.key} className="kb-card flex items-start gap-3 p-4">
              <span
                aria-hidden
                className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: DOT[check.health] }}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-[var(--kb-text)]">{check.label}</span>
                  <span className="text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">{WORD[check.health]}</span>
                  {check.ms !== null && <span className="text-[11px] tabular-nums text-[var(--kb-text-dim)]">{check.ms} ms</span>}
                </div>
                <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-prose text-xs text-[var(--kb-text-dim)]">
          Nothing on this page is about any one business — no names, no numbers, nothing from anybody&apos;s workspace. It
          says only whether the parts of the platform are answering, so that when something is wrong you can tell within a
          few seconds whether it is us or your connection.
        </p>
      </main>
    </div>
  );
}
