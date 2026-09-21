// What this workspace has used.
//
// Here so that nothing is ever a surprise. The rule the page exists to make
// visible: a limit never stops work somebody is doing. What it stops is the
// things that run on their own, and it says so twice before it stops
// anything.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { usage, usageSummary } from "@/lib/core/quotas";
import { prisma } from "@/lib/db";
import { AI_PROVIDERS, AI_PROVIDER_LABELS, getPlatformAiProvider } from "@/lib/ai/model";
import { billFor } from "@/lib/core/billing";
import { SEAT_CLASS_LABELS } from "@/lib/billing/plans";
import { platformGatewayStatus } from "@/lib/billing/collect";
import { setWorkspaceAiProviderAction, startPaymentAction } from "./actions";

export const dynamic = "force-dynamic";

const WORD: Record<string, string> = {
  fine: "Fine",
  "getting-close": "Getting close",
  over: "Over",
};

export default async function UsagePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);

  const [rows, summary, bill, tenant, platformProvider] = await Promise.all([
    usage(tenantId),
    usageSummary(tenantId),
    billFor(tenantId),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiProvider: true } }),
    getPlatformAiProvider(),
  ]);
  const chosen = tenant?.aiProvider ?? "";

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">This month</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{summary}</p>

      {access.role === "OWNER" && (
        <section className="kb-card mt-6 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">Your plan</h2>
            <span className="text-xs text-[var(--kb-text-dim)]">{bill.plan.name}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{bill.summary}</p>

          {bill.status !== "ACTIVE" && platformGatewayStatus().configured && (
            <form action={startPaymentAction.bind(null, tenantId)} className="mt-3">
              <button type="submit" className="kb-pill kb-pill-primary text-xs">
                Set up payment
              </button>
            </form>
          )}

          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            {([
              ["full", bill.seats.full],
              ["field", bill.seats.field],
              ["portal", bill.seats.portal],
            ] as const).map(([cls, count]) => (
              <div key={cls} className="rounded-lg p-2" style={{ background: "var(--kb-tint-blue)" }}>
                <dt className="text-[var(--kb-text-dim)]">
                  {SEAT_CLASS_LABELS[cls]}
                  {cls === "portal" && " — free"}
                </dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{count}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-[var(--kb-text-dim)]">Assistant work included this month</span>
              <span className="text-xs tabular-nums text-[var(--kb-text-dim)]">
                {Math.min(100, bill.allowanceUsedPercent)}% used
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--kb-panel-border)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, bill.allowanceUsedPercent)}%`,
                  background:
                    bill.allowanceUsedPercent >= 100
                      ? "var(--kb-tint-rose-ink)"
                      : bill.allowanceUsedPercent >= 80
                        ? "var(--kb-tint-amber-ink)"
                        : "var(--kb-tint-mint-ink)",
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
              Sized well above what a normal working month uses. Going over it never stops you
              asking the assistant something — it pauses the work that runs on its own.
            </p>
          </div>
        </section>
      )}

      <ul className="mt-6 grid gap-3">
        {rows.map((row) => (
          <li key={row.meter} className="kb-card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-[var(--kb-text)]">{row.label}</span>
              <span className="text-xs text-[var(--kb-text-dim)]">{WORD[row.standing]}</span>
            </div>
            <p className="mt-1 text-sm tabular-nums text-[var(--kb-text)]">
              {row.used.toLocaleString()} <span className="text-[var(--kb-text-dim)]">of {row.allowance.toLocaleString()} {row.unit}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--kb-panel-border)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, row.percent)}%`,
                  background:
                    row.standing === "over"
                      ? "var(--kb-tint-rose-ink)"
                      : row.standing === "getting-close"
                        ? "var(--kb-tint-amber-ink)"
                        : "var(--kb-tint-mint-ink)",
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{row.note}</p>
          </li>
        ))}
      </ul>

      {access.role === "OWNER" && (
        <section className="kb-card mt-4 p-4 sm:p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Whose model does this work</h2>
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            Most businesses leave this alone and run on whatever the platform is using
            ({AI_PROVIDER_LABELS[platformProvider]} today). Set it if you have a view about which
            company&apos;s model reads your books &mdash; the work itself is identical either way,
            and you can change it back at any time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[{ value: "", label: `Follow the platform (${AI_PROVIDER_LABELS[platformProvider]})` },
              ...AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }))].map((option) => (
              <form key={option.value || "default"} action={setWorkspaceAiProviderAction.bind(null, tenantId)}>
                <input type="hidden" name="provider" value={option.value} />
                <button
                  type="submit"
                  disabled={chosen === option.value}
                  className={`kb-pill text-xs ${chosen === option.value ? "kb-pill-primary" : "kb-pill-ghost"}`}
                >
                  {option.label}
                </button>
              </form>
            ))}
          </div>
        </section>
      )}

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">How a limit behaves here</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          <li>Nothing you ask for is ever refused because of an allowance. Being told the workspace is out of budget halfway through an invoice on a Friday afternoon is worse than the cost of finishing it.</li>
          <li>What pauses is the work that runs on its own — the overnight sweeps, the proactive drafting, the bulk sends.</li>
          <li>The counts come from your actual records rather than a separate tally, because a tally and reality drift apart within a week.</li>
          <li>The file size is an estimate from the number of photographs stored, not a measurement.</li>
        </ul>
      </section>
    </main>
  );
}
