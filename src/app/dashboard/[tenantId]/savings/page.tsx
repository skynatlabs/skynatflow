// Savings — the consolidation report.
//
// One ranked list of what the engine found, in money per year, with the
// effort each would take and how sure it is. The big number at the top is
// weighted by confidence on purpose: the unweighted total is the number a
// sales deck would show, and this page is meant to be read by the person
// who has to make the phone calls.

import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";
import { consolidationReport, EFFORT_LABEL, type SavingKind } from "@/lib/core/consolidation";
import { PageHeader } from "../PageHeader";

export const dynamic = "force-dynamic";

const KIND: Record<SavingKind, { label: string; bg: string; ink: string }> = {
  SUPPLIER: { label: "Suppliers", bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  TRIPS: { label: "Trips", bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  SUBSCRIPTION: { label: "Subscriptions", bg: "var(--kb-tint-violet)", ink: "var(--kb-tint-violet-ink)" },
  TIMING: { label: "Buying", bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  INSURANCE: { label: "Insurance", bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
};

export default async function SavingsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const report = await consolidationReport(tenantId);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Savings" crumbs={[{ label: "Savings" }]} />

      <section className="kb-card mb-5 px-5 py-4">
        <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Found, weighted by how sure each one is</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-3xl leading-none font-semibold tabular-nums text-[var(--kb-text)]">{money(report.weightedAnnualCents)}</span>
          <span className="text-xs text-[var(--kb-text-dim)]">a year · {money(report.totalAnnualCents)} if every one comes off in full · {report.savings.length} finding{report.savings.length === 1 ? "" : "s"}</span>
        </div>
        {report.failed.length > 0 && (
          <p className="mt-2 text-xs text-[var(--kb-tint-peach-ink)]">Could not read: {report.failed.join(", ")}. The rest of the page stands.</p>
        )}
      </section>

      {report.savings.length === 0 ? (
        <div className="kb-card px-6 py-10 text-center">
          <h3 className="font-semibold text-[var(--kb-text)]">Nothing to consolidate yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--kb-text-dim)]">
            The engine reads slips with line items, trips with stops, recurring payments and insurance
            policies with a premium. As those come in, the same money spent twice starts showing up here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {report.savings.map((s) => {
            const k = KIND[s.kind];
            return (
              <article key={s.key} className="kb-card flex flex-col p-0" style={{ borderTop: `3px solid ${k.ink}` }}>
                <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="kb-pill text-[10px] font-semibold uppercase" style={{ background: k.bg, color: k.ink }}>{k.label}</span>
                    <span className="kb-pill text-[10px] text-[var(--kb-text-dim)]">{EFFORT_LABEL[s.effort]}</span>
                    <span className="ml-auto text-[10px] text-[var(--kb-text-dim)]">{s.confidence}% sure</span>
                  </div>
                  <h3 className="leading-snug font-semibold text-balance text-[var(--kb-text)]">{s.headline}</h3>
                  <p className="text-xs leading-relaxed text-[var(--kb-text-dim)]">{s.detail}</p>
                  <p className="text-xl font-semibold tabular-nums text-[var(--kb-text)]">
                    {money(s.annualCents)} <span className="text-xs font-normal text-[var(--kb-text-dim)]">a year</span>
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-[var(--kb-tint-blue)]/35 px-3 py-2 text-[11px]">
                    {s.evidence.slice(0, 6).map((e, i) => (
                      <div key={i} className="contents">
                        <dt className="text-[var(--kb-text-dim)]">{e.label}</dt>
                        <dd className="font-medium tabular-nums text-[var(--kb-text)]">{e.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-[var(--kb-text)]"><span className="font-medium">To do: </span>{s.proposedAction}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {report.recurring.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-1 text-sm font-semibold text-[var(--kb-text)]">Everything that recurs</h3>
          <p className="mb-3 text-xs text-[var(--kb-text-dim)]">Every regular payment, from the books and from bank lines nobody matched, with what it costs a year.</p>
          <div className="kb-card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
                <tr className="border-b border-[var(--kb-panel-border)]">
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Cadence</th>
                  <th className="px-4 py-2 text-right">Each</th>
                  <th className="px-4 py-2 text-right">A year</th>
                  <th className="px-4 py-2">Seen</th>
                  <th className="px-4 py-2">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kb-panel-border)] tabular-nums">
                {report.recurring.map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-2">
                      {r.label}
                      {r.source === "bank" && <span className="block text-[10px] text-[var(--kb-tint-peach-ink)]">on the bank statement, never recorded</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">{r.cadence.toLowerCase()}</td>
                    <td className="px-4 py-2 text-right">{money(r.typicalCents)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(r.annualCents)}</td>
                    <td className="px-4 py-2 text-xs text-[var(--kb-text-dim)]">{r.occurrences}× · last {r.lastAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-xs text-[var(--kb-text-dim)]">{r.who.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
