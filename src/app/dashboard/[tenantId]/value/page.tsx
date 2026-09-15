// The value ledger.
//
// What the officers found, what the owner took on, what has since been
// verified in the data, and what the platform cost — in money, by month and
// by officer. The three columns are deliberately not one column. A product
// that reported only what it found would be writing its own review.

import { notFound } from "next/navigation";
import { Officer } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";
import { valueSummary } from "@/lib/core/valueLedger";
import { PageHeader } from "../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { setMonthlyFeeAction } from "./actions";

export const dynamic = "force-dynamic";

const OFFICER_NAME: Record<Officer, string> = {
  CEO: "CEO",
  CFO: "CFO",
  COO: "COO",
  LEGAL: "Legal",
  SALES: "Sales",
  EFFICIENCY: "Efficiency",
  SYSTEM: "Watch",
};

const KIND_LABEL: Record<string, string> = {
  IDENTIFIED: "Found",
  ACCEPTED: "Taken on",
  REALISED: "Verified",
  COST: "Cost",
};

export default async function ValuePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true, monthlyFeeCents: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const v = await valueSummary(tenantId, { months: 3 });

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Value" crumbs={[{ label: "Value" }]} />

      <section className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Found", cents: v.totals.identifiedCents, note: "put in front of you" },
          { label: "Taken on", cents: v.totals.acceptedCents, note: "you said yes to" },
          { label: "Verified", cents: v.totals.realisedCents, note: v.verifiedPercent !== null ? `${v.verifiedPercent}% of what was taken on` : "seen in the data since" },
          { label: "Net, verified", cents: v.netVerifiedCents, note: v.feeSet ? `after ${money(v.totals.costCents)} in fees` : "fee not set — see below" },
        ].map((t) => (
          <div key={t.label} className="kb-card px-5 py-4">
            <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{t.label}</p>
            <p className="mt-1 text-2xl leading-none font-semibold tabular-nums text-[var(--kb-text)]" style={{ color: t.cents < 0 ? "var(--kb-tint-peach-ink)" : undefined }}>
              {money(t.cents)}
            </p>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{t.note}</p>
          </div>
        ))}
      </section>

      <p className="mb-5 max-w-2xl text-xs text-[var(--kb-text-dim)]">
        Three months. <span className="font-medium text-[var(--kb-text)]">Found</span> is what an officer raised with a figure attached.{" "}
        <span className="font-medium text-[var(--kb-text)]">Taken on</span> is what you accepted.{" "}
        <span className="font-medium text-[var(--kb-text)]">Verified</span> is only what the data can confirm afterwards — a duplicate removed,
        a subscription that stopped, a price that came down. Everything else stays unverified, which is what it is.
      </p>

      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="kb-card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
              <tr className="border-b border-[var(--kb-panel-border)]">
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Found</th>
                <th className="px-4 py-2 text-right">Taken on</th>
                <th className="px-4 py-2 text-right">Verified</th>
                <th className="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kb-panel-border)] tabular-nums">
              {v.months.map((m) => (
                <tr key={m.month}>
                  <td className="px-4 py-2">{m.month}</td>
                  <td className="px-4 py-2 text-right">{money(m.identifiedCents)}</td>
                  <td className="px-4 py-2 text-right">{money(m.acceptedCents)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{money(m.realisedCents)}</td>
                  <td className="px-4 py-2 text-right">{money(m.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kb-card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
              <tr className="border-b border-[var(--kb-panel-border)]">
                <th className="px-4 py-2">Officer</th>
                <th className="px-4 py-2 text-right">Found</th>
                <th className="px-4 py-2 text-right">Taken on</th>
                <th className="px-4 py-2 text-right">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kb-panel-border)] tabular-nums">
              {v.byOfficer.length === 0 ? (
                <tr><td className="px-4 py-3 text-xs text-[var(--kb-text-dim)]" colSpan={4}>Nothing with a figure on it yet.</td></tr>
              ) : (
                v.byOfficer.map((o) => (
                  <tr key={o.officer}>
                    <td className="px-4 py-2">{OFFICER_NAME[o.officer]}</td>
                    <td className="px-4 py-2 text-right">{money(o.identifiedCents)}</td>
                    <td className="px-4 py-2 text-right">{money(o.acceptedCents)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(o.realisedCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {v.recent.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--kb-text)]">The ledger</h3>
          <div className="kb-card divide-y divide-[var(--kb-panel-border)] p-0">
            {v.recent.map((e, i) => (
              <div key={i} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--kb-text)]">
                    <span className="kb-pill mr-2 !py-0.5 text-[10px]">{KIND_LABEL[e.kind]}</span>
                    {e.headline ?? e.method ?? KIND_LABEL[e.kind]}
                  </p>
                  {e.method && e.headline && <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{e.method}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">{money(e.cents)}</p>
                  <p className="text-[10px] text-[var(--kb-text-dim)]">{OFFICER_NAME[e.officer]} · {e.at.toISOString().slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {access.role === "OWNER" && (
        <section className="kb-card px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">What this costs you a month</h3>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Set once. The ledger writes it against each month so the net figure above is honest.</p>
          <form action={setMonthlyFeeAction.bind(null, tenantId)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="text-[var(--kb-text-dim)]">Monthly fee</span>
              <input name="monthlyFee" type="number" step="0.01" inputMode="decimal" defaultValue={tenant.monthlyFeeCents !== null ? (tenant.monthlyFeeCents / 100).toFixed(2) : ""} className="kb-input mt-1 w-36 text-sm" />
            </label>
            <SubmitButton>Save</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
