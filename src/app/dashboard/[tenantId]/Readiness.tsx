// The setup strip.
//
// It leads with the single next thing rather than a wall of ten, because a
// wall is what makes people close it. The rest is there, one click away, for
// anyone who wants to see the whole road.
//
// It removes itself once the business is actually operating — invoicing and
// getting paid. A checklist that stays up after you've finished with it stops
// being read, and then so does everything next to it.

import Link from "next/link";
import type { Readiness } from "@/lib/core/readiness";

export function ReadinessStrip({
  readiness,
}: {
  readiness: Readiness;
}) {
  if (readiness.operational) return null;

  const { steps, doneCount, total, percent, nextStep } = readiness;

  return (
    <section className="kb-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--kb-panel-border)] px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--kb-text)]">
            {nextStep ? nextStep.label : "Nearly there"}
          </p>
          <p className="truncate text-xs text-[var(--kb-text-dim)]">
            {nextStep?.why ?? "One or two things left."}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[11px] tabular-nums text-[var(--kb-text-dim)]">
            {doneCount}/{total}
          </span>
          {/* A bar, not a ring: it reads as progress along a road, which is
              what this is, rather than as a score out of ten. */}
          <span
            className="hidden h-1.5 w-24 overflow-hidden rounded-full sm:block"
            style={{ background: "var(--kb-panel-border)" }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Setup progress"
          >
            <span
              className="block h-full rounded-full transition-all"
              style={{ width: `${percent}%`, background: "var(--kb-accent-a)" }}
            />
          </span>
          {nextStep && (
            <Link href={nextStep.href} className="kb-pill kb-pill-primary shrink-0 text-xs">
              Do it
            </Link>
          )}
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer px-4 py-2 text-[11px] text-[var(--kb-text-dim)] hover:text-[var(--kb-text)] sm:px-5">
          See everything
        </summary>
        <ul className="grid gap-1 px-4 pb-3 sm:grid-cols-2 sm:px-5">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                href={step.href}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--kb-bg)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-[2px] shrink-0 text-xs"
                  style={{
                    color: step.done ? "var(--kb-tint-mint-ink)" : "var(--kb-text-dim)",
                  }}
                >
                  {step.done ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-xs font-medium"
                    style={{
                      color: step.done ? "var(--kb-text-dim)" : "var(--kb-text)",
                      textDecoration: step.done ? "line-through" : "none",
                    }}
                  >
                    {step.label}
                  </span>
                  {!step.done && (
                    <span className="block text-[11px] leading-snug text-[var(--kb-text-dim)]">
                      {step.why}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
