// Who reports to you, and how far each one may go without asking.
//
// The ladder exists in code whether or not this page does, which is exactly
// the problem: a permission model nobody can see is one nobody trusts. The
// honest version of "your CFO can draft but not send" is a row on a screen
// with the setting visible and changeable, not a default buried in a map.

import { notFound } from "next/navigation";
import { Officer } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listCeilings, RUNGS, RUNG_LABELS, type Rung } from "@/lib/agent/ladder";
import { PageHeader } from "../../PageHeader";
import { updateCeiling, turnaroundAction } from "./actions";
import { packFor } from "@/lib/core/industryPacks";
import { sharedMemory } from "@/lib/agent/observations";

export const dynamic = "force-dynamic";

const ROLE: Record<Officer, { name: string; remit: string }> = {
  CEO: { name: "Chief Executive", remit: "Reads everything the others find and says which one actually matters this month." },
  CFO: { name: "Chief Financial Officer", remit: "The books, the bank, debtors, margins and whether you are trading at a loss." },
  COO: { name: "Chief Operating Officer", remit: "Jobs, routes, stock and the day actually running as planned." },
  LEGAL: { name: "Legal Counsel", remit: "Renewals, licences, contract notice periods and what lapses if nobody acts." },
  SALES: { name: "Sales Consultant", remit: "Quotes going cold, customers going quiet, and what to say to them." },
  EFFICIENCY: { name: "Efficiency Consultant", remit: "Where the same money is being spent twice, and what can be consolidated." },
  SYSTEM: { name: "Automatic watch", remit: "Deadline arithmetic with no model behind it. Keeps working when the AI does not." },
};

export default async function OfficersPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, niche: true, turnaroundMode: true },
  });
  if (!tenant) notFound();

  const [settings, memory] = await Promise.all([listCeilings(tenantId), sharedMemory(tenantId, 20)]);
  const pack = packFor(tenant.niche);
  const save = updateCeiling.bind(null, tenantId);

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="Your officers"
        crumbs={[{ label: "Settings", href: `/dashboard/${tenantId}/settings` }, { label: "Officers" }]}
      />

      <p className="mb-5 max-w-2xl text-sm text-[var(--kb-text-dim)]">
        Each one watches its own part of the business and reports on{" "}
        <span className="font-medium text-[var(--kb-text)]">The Brief</span>. What
        changes below is how far it may go before a person is involved — not
        what it is allowed to look at.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {settings.map((s) => {
          const role = ROLE[s.officer];
          const maxIndex = RUNGS.indexOf(s.maxAllowed);

          return (
            <article key={s.officer} className="kb-card px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--kb-text)]">{role.name}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--kb-text-dim)]">
                    {role.remit}
                  </p>
                  {s.officer !== "SYSTEM" && pack.watches[s.officer as keyof typeof pack.watches] && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--kb-text)]">
                      <span className="font-medium">In {pack.label.toLowerCase()}: </span>
                      {pack.watches[s.officer as keyof typeof pack.watches]}
                    </p>
                  )}
                </div>
                {s.capped && (
                  <span
                    className="kb-pill shrink-0 text-[10px] whitespace-nowrap text-[var(--kb-text-dim)]"
                    title={`Cannot be raised above "${RUNG_LABELS[s.maxAllowed]}", by anyone.`}
                  >
                    Capped
                  </span>
                )}
              </div>

              <form action={save} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="officer" value={s.officer} />
                <label className="sr-only" htmlFor={`ceiling-${s.officer}`}>
                  How far {role.name} may go
                </label>
                <select
                  id={`ceiling-${s.officer}`}
                  name="ceiling"
                  defaultValue={s.ceiling}
                  className="kb-input flex-1 text-xs"
                >
                  {RUNGS.map((rung: Rung, i) => (
                    // Rungs above the hard cap are shown and disabled rather
                    // than hidden, so it is clear the limit is deliberate
                    // rather than a level this product forgot to build.
                    <option key={rung} value={rung} disabled={i > maxIndex}>
                      {RUNG_LABELS[rung]}
                      {i > maxIndex ? " — not available for this role" : ""}
                    </option>
                  ))}
                </select>
                <button type="submit" className="kb-pill kb-pill-primary text-xs">
                  Save
                </button>
              </form>
            </article>
          );
        })}
      </div>

      <section className="kb-card mt-6 px-5 py-4" style={{ borderTop: `3px solid ${tenant.turnaroundMode ? "var(--kb-tint-peach-ink)" : "var(--kb-panel-border)"}` }}>
        <h3 className="font-semibold text-[var(--kb-text)]">Turnaround mode</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--kb-text-dim)]">
          For a business genuinely in trouble. Every officer&apos;s findings are reordered around cash: money owed, cash running out, tax already spent and costs that can stop now come first. Advice about margin and growth waits — it is worthless to somebody who cannot make payroll on Friday.
        </p>
        <form action={turnaroundAction.bind(null, tenantId)} className="mt-3">
          <input type="hidden" name="on" value={tenant.turnaroundMode ? "false" : "true"} />
          <button type="submit" className={`kb-pill text-xs ${tenant.turnaroundMode ? "kb-pill-ghost" : "kb-pill-primary"}`}>
            {tenant.turnaroundMode ? "Switch turnaround mode off" : "Switch turnaround mode on"}
          </button>
        </form>
      </section>

      <section className="kb-card mt-6 px-5 py-4">
        <h3 className="font-semibold text-[var(--kb-text)]">What you have decided</h3>
        <p className="mt-1 max-w-2xl text-xs text-[var(--kb-text-dim)]">
          Every officer reads this before suggesting anything. Something you set aside is not raised again, and a related point from another officer arrives with less confidence and your earlier decision quoted beside it.
        </p>
        {memory.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">Nothing decided yet. Take on or set aside a finding on The Brief and it is remembered here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)] text-sm">
            {memory.map((m, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="kb-pill mr-2 !py-0.5 text-[10px]">{m.officer}</span>
                  {m.headline}
                  {m.why && <span className="block text-[11px] text-[var(--kb-text-dim)]">{m.why}</span>}
                </span>
                <span className="shrink-0 text-right text-[11px]" style={{ color: m.outcome === "accepted" ? "var(--kb-tint-mint-ink)" : "var(--kb-text-dim)" }}>
                  {m.outcome}
                  <span className="block text-[var(--kb-text-dim)]">{m.on ? m.on.toISOString().slice(0, 10) : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}