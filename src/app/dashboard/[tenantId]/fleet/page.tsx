// Fleet — what the road is costing, and what to do about it.
//
// The COO's desk for anything that moves: standing time to bill, recoverable
// costs to invoice, empty runs, fuel per 100 km, services due by the
// odometer, tyres per kilometre, loads over the limit, owner-drivers whose
// cover has lapsed, unusual routes and incidents. Each section is empty
// until its inputs exist, and says what those inputs are.

import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";
import {
  detentionOwed, unbilledRecoverables, emptyRunning, fuelConsumption, maintenanceDue,
  consumablesByAsset, overloadedTrips, subcontractorsAtRisk, routeDeviations, listIncidents,
} from "@/lib/core/fleetOps";
import { PageHeader } from "../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { IncidentForm } from "./IncidentForm";
import {
  billDetentionAction, billRecoverablesAction, recordServiceAction, setSpecAction,
  setDetentionRateAction, reportIncidentAction,
} from "./actions";

export const dynamic = "force-dynamic";

function Section({ title, hint, children, empty }: { title: string; hint: string; children: React.ReactNode; empty: boolean }) {
  return (
    <section className="kb-card px-5 py-4">
      <h3 className="text-sm font-semibold text-[var(--kb-text)]">{title}</h3>
      {empty ? <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{hint}</p> : <div className="mt-3">{children}</div>}
    </section>
  );
}

export default async function FleetPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true, detentionRateCents: true, detentionFreeMinutes: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);
  const owner = access.role === "OWNER";

  const [detention, recoverables, empty, fuel, service, consumables, overloads, subs, deviations, incidents, vehicles] = await Promise.all([
    detentionOwed(tenantId), unbilledRecoverables(tenantId), emptyRunning(tenantId), fuelConsumption(tenantId),
    maintenanceDue(tenantId, 5_000), consumablesByAsset(tenantId), overloadedTrips(tenantId), subcontractorsAtRisk(tenantId),
    routeDeviations(tenantId), listIncidents(tenantId, 10),
    prisma.asset.findMany({
      where: { tenantId, status: { notIn: ["LOST", "RETIRED"] }, capacityUnit: "KM" },
      select: { id: true, name: true, serviceIntervalKm: true, lastServiceKm: true, tareKg: true, maxGrossKg: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const unbilledDetention = detention.filter((d) => !d.billed);
  const recoverableByCustomer = new Map<string, { name: string; cents: number; count: number }>();
  for (const r of recoverables) {
    if (!r.transaction) continue;
    const cur = recoverableByCustomer.get(r.transaction.partyId) ?? { name: r.transaction.party.name, cents: 0, count: 0 };
    cur.cents += r.amountCents;
    cur.count += 1;
    recoverableByCustomer.set(r.transaction.partyId, cur);
  }

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Fleet" crumbs={[{ label: "Fleet" }]} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Standing time to bill" hint="Arrival and departure at each stop on the Trips page turn waiting at a gate into a charge. Set a rate below." empty={unbilledDetention.length === 0}>
          <ul className="divide-y divide-[var(--kb-panel-border)] text-sm">
            {unbilledDetention.slice(0, 8).map((d) => (
              <li key={d.stopId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{d.partyName}<span className="block text-xs text-[var(--kb-text-dim)]">{d.arrivedAt.toISOString().slice(0, 16).replace("T", " ")} → {d.departedAt.toISOString().slice(11, 16)} · {d.billableMinutes} min over</span></span>
                <span className="flex items-center gap-2 tabular-nums">
                  {d.cents ? money(d.cents) : <span className="text-xs text-[var(--kb-text-dim)]">no rate</span>}
                  {d.cents && d.partyId && (
                    <form action={billDetentionAction.bind(null, tenantId)}><input type="hidden" name="stopId" value={d.stopId} /><SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Bill</SubmitButton></form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recoverable costs not yet invoiced" hint="Mark tolls, permits and materials as recoverable when you record them, tagged to the customer's document." empty={recoverableByCustomer.size === 0}>
          <ul className="divide-y divide-[var(--kb-panel-border)] text-sm">
            {[...recoverableByCustomer.entries()].map(([partyId, c]) => (
              <li key={partyId} className="flex items-center justify-between gap-2 py-2">
                <span>{c.name}<span className="block text-xs text-[var(--kb-text-dim)]">{c.count} cost{c.count === 1 ? "" : "s"}</span></span>
                <span className="flex items-center gap-2 tabular-nums">{money(c.cents)}
                  <form action={billRecoverablesAction.bind(null, tenantId)}><input type="hidden" name="partyId" value={partyId} /><SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Invoice</SubmitButton></form>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Services due" hint="Give a vehicle a service interval below; odometer readings from fuel slips and trips do the rest." empty={service.length === 0}>
          <ul className="divide-y divide-[var(--kb-panel-border)] text-sm">
            {service.map((s) => (
              <li key={s.assetId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{s.assetName}<span className="block text-xs" style={{ color: s.kmRemaining <= 0 ? "var(--kb-tint-peach-ink)" : "var(--kb-text-dim)" }}>{s.kmRemaining <= 0 ? `${Math.abs(s.kmRemaining).toLocaleString("en-US")} km overdue` : `in ${s.kmRemaining.toLocaleString("en-US")} km${s.daysRemaining !== null ? ` · ~${s.daysRemaining} days` : ""}`}</span></span>
                <form action={recordServiceAction.bind(null, tenantId)} className="flex items-center gap-1">
                  <input type="hidden" name="assetId" value={s.assetId} />
                  <input name="odometerKm" type="number" inputMode="numeric" defaultValue={s.odometerKm} className="kb-input w-24 text-xs" />
                  <SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Serviced</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Fuel per 100 km" hint="Record litres and the odometer on fuel slips against the vehicle." empty={fuel.length === 0}>
          <table className="w-full text-sm tabular-nums">
            <tbody className="divide-y divide-[var(--kb-panel-border)]">
              {fuel.map((f) => (
                <tr key={f.assetId}>
                  <td className="py-1.5">{f.assetName}<span className="block text-xs text-[var(--kb-text-dim)]">{f.fills} fills · {f.km.toLocaleString("en-US")} km</span></td>
                  <td className="py-1.5 text-right font-semibold">{f.per100 !== null ? `${f.per100} L` : "—"}</td>
                  <td className="py-1.5 text-right text-xs" style={{ color: (f.deviationPercent ?? 0) >= 15 ? "var(--kb-tint-peach-ink)" : "var(--kb-text-dim)" }}>{f.deviationPercent !== null ? `${f.deviationPercent > 0 ? "+" : ""}${f.deviationPercent}% recently` : "needs 8 fills"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Empty running" hint="Runs with a from and to on the Trips page show which ended away from base with nothing coming back." empty={empty.length === 0}>
          <ul className="divide-y divide-[var(--kb-panel-border)] text-sm">
            {empty.slice(0, 8).map((e) => (
              <li key={e.tripId} className="flex justify-between gap-2 py-1.5"><span>{e.assetName} → {e.destination}</span><span className="text-xs text-[var(--kb-text-dim)]">{e.endedAt.toISOString().slice(0, 10)}{e.kmFromBase ? ` · ${e.kmFromBase} km out` : ""}</span></li>
            ))}
          </ul>
        </Section>

        <Section title="Tyres, blades and filters" hint="Record them against the vehicle with the odometer reading when fitted." empty={consumables.length === 0}>
          <table className="w-full text-sm tabular-nums">
            <tbody className="divide-y divide-[var(--kb-panel-border)]">
              {consumables.map((c) => (
                <tr key={`${c.assetId}${c.kind}`}><td className="py-1.5">{c.assetName} · {c.kind}s</td><td className="py-1.5 text-right">{money(c.spentCents)}</td><td className="py-1.5 text-right text-xs text-[var(--kb-text-dim)]">{c.centsPerKm !== null ? `${money(Math.round(c.centsPerKm * 100) / 100)}/km` : "no km yet"}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Loads over the limit" hint="Set a vehicle's empty and permissible weights below, and loads on the stops of a planned run." empty={overloads.length === 0}>
          <ul className="text-sm">
            {overloads.map((o) => <li key={o.tripId} className="py-1" style={{ color: "var(--kb-tint-peach-ink)" }}>{o.assetName}: peak {o.peakGrossKg.toLocaleString("en-US")} kg, {o.overKg.toLocaleString("en-US")} kg over</li>)}
          </ul>
        </Section>

        <Section title="Owner-drivers" hint="Add subcontractors as parties with the SUBCONTRACTOR role and record their cover on the compliance page." empty={subs.length === 0}>
          <ul className="text-sm">
            {subs.map((s) => <li key={s.partyId} className="py-1">{s.name}<span className="block text-xs text-[var(--kb-tint-peach-ink)]">{s.lapsed.length > 0 ? `${s.lapsed[0].title} lapsed — blocked from runs` : "no cover on record"}</span></li>)}
          </ul>
        </Section>

        <Section title="Unusual routes" hint="Needs five runs on a lane to know what usual is." empty={deviations.length === 0}>
          <ul className="text-sm">
            {deviations.map((d) => <li key={d.tripId} className="py-1">{d.laneKey}: {d.distanceKm} km against a usual {d.laneMedianKm} km (+{d.deviationPercent}%)</li>)}
          </ul>
        </Section>
      </div>

      <section className="kb-card mt-5 px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--kb-text)]">Report an incident</h3>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">At the scene, while the facts are still there. The insurer&apos;s pack builds as you go and says what it still needs.</p>
        <div className="mt-3"><IncidentForm action={reportIncidentAction.bind(null, tenantId)} vehicles={vehicles.map((v) => ({ id: v.id, name: v.name }))} /></div>
        {incidents.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--kb-panel-border)] text-sm">
            {incidents.map((i) => (
              <li key={i.id} className="py-2">
                {i.at.toISOString().slice(0, 16).replace("T", " ")} · {i.asset?.name ?? "no vehicle"} — {i.description.slice(0, 80)}
                <span className="block text-xs" style={{ color: i.missing.length ? "var(--kb-tint-yellow-ink)" : "var(--kb-tint-mint-ink)" }}>{i.missing.length ? `Still needs: ${i.missing.join("; ")}` : "Pack complete"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {owner && (
        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="kb-card px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Standing time rate</h3>
            <form action={setDetentionRateAction.bind(null, tenantId)} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
              <label><span className="text-[var(--kb-text-dim)]">Free minutes</span><input name="freeMinutes" type="number" defaultValue={tenant.detentionFreeMinutes} className="kb-input mt-1 block w-24 text-sm" /></label>
              <label><span className="text-[var(--kb-text-dim)]">Per hour after</span><input name="ratePerHour" type="number" step="0.01" defaultValue={tenant.detentionRateCents !== null ? (tenant.detentionRateCents / 100).toFixed(2) : ""} className="kb-input mt-1 block w-28 text-sm" /></label>
              <SubmitButton>Save</SubmitButton>
            </form>
          </div>
          <div className="kb-card px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Vehicle specs</h3>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Service interval and last service reading, empty and permissible weight.</p>
            <div className="mt-2 space-y-2">
              {vehicles.map((v) => (
                <form key={v.id} action={setSpecAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-1 text-xs">
                  <input type="hidden" name="assetId" value={v.id} />
                  <span className="min-w-24 flex-1">{v.name}</span>
                  <input name="serviceIntervalKm" type="number" placeholder="every km" defaultValue={v.serviceIntervalKm ?? ""} className="kb-input w-20 text-xs" />
                  <input name="lastServiceKm" type="number" placeholder="last at" defaultValue={v.lastServiceKm ?? ""} className="kb-input w-20 text-xs" />
                  <input name="tareKg" type="number" placeholder="tare kg" defaultValue={v.tareKg ?? ""} className="kb-input w-20 text-xs" />
                  <input name="maxGrossKg" type="number" placeholder="max kg" defaultValue={v.maxGrossKg ?? ""} className="kb-input w-20 text-xs" />
                  <SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Save</SubmitButton>
                </form>
              ))}
              {vehicles.length === 0 && <p className="text-xs text-[var(--kb-text-dim)]">Mark an asset&apos;s capacity as per km on the Costs page and it appears here.</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
