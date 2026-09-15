// One asset — its history, its money, its paperwork, and what the officers
// have noticed about it, with the verbs that apply to a vehicle or machine.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { assetHistory } from "@/lib/core/assets";
import { assetCosts, lastDays } from "@/lib/core/costing";
import { currentOdometer } from "@/lib/core/fleetOps";
import { formatMoney } from "@/lib/core/currency";
import { SPENT } from "@/lib/core/expenses";
import { PageHeader } from "../../PageHeader";
import { RecordPanel } from "@/components/dashboard/RecordPanel";

export const dynamic = "force-dynamic";

export default async function AssetRecordPage({ params }: { params: Promise<{ tenantId: string; id: string }> }) {
  const { tenantId, id } = await params;
  await requireTenantAccess(tenantId);

  const asset = await prisma.asset.findFirst({
    where: { id, tenantId },
    include: { holder: { select: { user: { select: { name: true, email: true } } } } },
  });
  if (!asset) notFound();

  const [tenant, movements, costs, odo, expenses, obligations, trips, incidents] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    assetHistory(tenantId, id),
    assetCosts(tenantId, lastDays(90)),
    currentOdometer(tenantId, id),
    prisma.expense.findMany({ where: { tenantId, assetId: id, status: SPENT }, orderBy: { spentOn: "desc" }, take: 12, select: { id: true, descriptionText: true, amountCents: true, spentOn: true } }),
    prisma.obligation.findMany({ where: { tenantId, assetId: id }, orderBy: { dueAt: "asc" }, select: { id: true, title: true, dueAt: true, status: true, amountCents: true } }),
    prisma.trip.findMany({ where: { tenantId, assetId: id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, originText: true, destinationText: true, distanceKm: true, startedAt: true, status: true } }),
    prisma.incident.findMany({ where: { tenantId, assetId: id }, orderBy: { at: "desc" }, take: 5, select: { id: true, at: true, description: true, missing: true } }),
  ]);
  const money = (c: number) => formatMoney(c, tenant?.currency ?? "ZAR");
  const cost = costs.find((c) => c.assetId === id);
  const d = `/dashboard/${tenantId}`;

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title={asset.name} crumbs={[{ label: "Assets", href: `${d}/assets` }, { label: asset.name }]} />
      <p className="text-sm text-[var(--kb-text-dim)]">
        {[asset.category, asset.registration ?? asset.serial, asset.status.toLowerCase().replace("_", " "), asset.holder ? `with ${asset.holder.user.name ?? asset.holder.user.email}` : null].filter(Boolean).join(" · ")}
      </p>

      <RecordPanel
        tenantId={tenantId}
        subjectId={id}
        actions={[
          { label: "Start a trip", href: `${d}/trips` },
          { label: "Record fuel or a repair", href: `${d}/expenses` },
          { label: "Report an incident", href: `${d}/fleet` },
          { label: "Service & specs", href: `${d}/fleet` },
          { label: "Add a renewal", href: `${d}/compliance` },
        ]}
        facts={[
          ...(cost ? [
            { label: "Cost, 90 days", value: money(cost.totalCents) },
            ...(cost.costPerUnitCents !== null && cost.capacityUnit ? [{ label: `Per ${cost.capacityUnit.toLowerCase()}`, value: money(cost.costPerUnitCents) }] : []),
          ] : []),
          ...(odo !== null ? [{ label: "Odometer", value: `${odo.toLocaleString("en-US")} km` }] : []),
          ...(asset.purchaseCents ? [{ label: "Bought for", value: money(asset.purchaseCents) }] : []),
        ]}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="kb-card px-5 py-4">
          <h2 className="text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Costs</h2>
          {expenses.length === 0 ? <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Nothing recorded against it yet.</p> : (
            <ul className="mt-2 divide-y divide-[var(--kb-panel-border)] text-sm">
              {expenses.map((e) => <li key={e.id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{e.descriptionText}</span><span className="tabular-nums">{money(e.amountCents)} <span className="text-[11px] text-[var(--kb-text-dim)]">{e.spentOn.toISOString().slice(0, 10)}</span></span></li>)}
            </ul>
          )}
        </section>
        <section className="kb-card px-5 py-4">
          <h2 className="text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Paperwork</h2>
          {obligations.length === 0 ? <p className="mt-1 text-xs text-[var(--kb-text-dim)]">No licence, cover or roadworthy recorded. <Link href={`${d}/compliance`} className="underline">Add one</Link> and it is watched.</p> : (
            <ul className="mt-2 divide-y divide-[var(--kb-panel-border)] text-sm">
              {obligations.map((o) => <li key={o.id} className="flex justify-between gap-2 py-1.5"><span>{o.title}</span><span className="text-[11px] text-[var(--kb-text-dim)]">{o.status === "OPEN" ? `due ${o.dueAt.toISOString().slice(0, 10)}` : o.status.toLowerCase()}</span></li>)}
            </ul>
          )}
        </section>
        <section className="kb-card px-5 py-4">
          <h2 className="text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Trips</h2>
          {trips.length === 0 ? <p className="mt-1 text-xs text-[var(--kb-text-dim)]">No trips yet.</p> : (
            <ul className="mt-2 divide-y divide-[var(--kb-panel-border)] text-sm">
              {trips.map((t) => <li key={t.id} className="flex justify-between gap-2 py-1.5"><span>{t.originText ?? "?"} → {t.destinationText ?? "?"}</span><span className="text-[11px] text-[var(--kb-text-dim)]">{t.distanceKm ? `${t.distanceKm} km · ` : ""}{t.startedAt ? t.startedAt.toISOString().slice(0, 10) : t.status.toLowerCase()}</span></li>)}
            </ul>
          )}
        </section>
        <section className="kb-card px-5 py-4">
          <h2 className="text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Who has had it</h2>
          {movements.length === 0 ? <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Never issued.</p> : (
            <ul className="mt-2 divide-y divide-[var(--kb-panel-border)] text-sm">
              {movements.map((m) => <li key={m.id} className="flex justify-between gap-2 py-1.5"><span>{m.kind}{m.note ? ` — ${m.note}` : ""}</span><span className="text-[11px] text-[var(--kb-text-dim)]">{m.at.toISOString().slice(0, 10)}</span></li>)}
            </ul>
          )}
          {incidents.length > 0 && (
            <>
              <h2 className="mt-4 text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Incidents</h2>
              <ul className="mt-2 text-sm">{incidents.map((i) => <li key={i.id} className="py-1">{i.at.toISOString().slice(0, 10)} — {i.description.slice(0, 70)}{i.missing.length ? <span className="block text-[11px] text-[var(--kb-tint-yellow-ink)]">pack incomplete</span> : null}</li>)}</ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
