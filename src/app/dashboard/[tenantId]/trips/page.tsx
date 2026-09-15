// Trips — the object every logistics calculation hangs from.
//
// One page for the whole of a run: start it, add the stops, arrive and leave
// each one, end it with the odometer. The distance and the driver's hours
// flow from here into cost per kilometre and margin per job without anyone
// typing a second thing. Built for a phone first: a driver at a gate, one
// thumb, ten seconds.

import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listTrips, tripHours } from "@/lib/core/trips";
import { formatMoney } from "@/lib/core/currency";
import { costRates, lastDays, tripCostCents } from "@/lib/core/costing";
import { PageHeader } from "../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { TripTracker } from "./TripTracker";
import { StopCapture } from "./StopCapture";
import {
  startTripAction,
  endTripAction,
  cancelTripAction,
  addStopAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PURPOSES: Array<{ value: string; label: string }> = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "COLLECTION", label: "Collection" },
  { value: "SITE_VISIT", label: "Site visit" },
  { value: "APPOINTMENT", label: "Appointment" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "OTHER", label: "Other" },
];

const STATUS_TONE: Record<string, { bg: string; ink: string; label: string }> = {
  PLANNED: { bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)", label: "Planned" },
  UNDERWAY: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)", label: "Underway" },
  DONE: { bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)", label: "Done" },
  CANCELLED: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)", label: "Cancelled" },
};

const INPUT = "kb-input mt-1 w-full text-sm";

function when(d: Date | null) {
  return d ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default async function TripsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);

  const [tenant, trips, vehicles, drivers, customers, me, rates] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    listTrips(tenantId, { since: lastDays(30).from, take: 60 }),
    prisma.asset.findMany({
      where: { tenantId, status: { notIn: ["LOST", "RETIRED"] }, OR: [{ capacityUnit: { not: null } }, { category: { contains: "vehicle", mode: "insensitive" } }] },
      select: { id: true, name: true, registration: true },
      orderBy: { name: "asc" },
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.party.findMany({
      where: { tenantId, role: "CUSTOMER" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    access.membershipId
      ? prisma.membership.findUnique({ where: { id: access.membershipId }, select: { locationConsentAt: true } })
      : null,
    costRates(tenantId, lastDays(90)),
  ]);
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const underway = trips.filter((t) => t.status === "UNDERWAY");
  const mine = underway.find((t) => t.driver?.id === access.membershipId) ?? underway[0] ?? null;
  const start = startTripAction.bind(null, tenantId);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Trips" crumbs={[{ label: "Trips" }]} />

      <div className="mb-5">
        <TripTracker tenantId={tenantId} tripId={mine?.id ?? null} hasConsent={Boolean(me?.locationConsentAt)} />
      </div>

      {/* ---- underway --------------------------------------------------- */}
      {underway.length > 0 && (
        <section className="mb-6 grid gap-4 lg:grid-cols-2">
          {underway.map((t) => (
            <article key={t.id} className="kb-card p-0" style={{ borderTop: "3px solid var(--kb-tint-yellow-ink)" }}>
              <div className="px-5 pt-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">
                      Underway · {PURPOSES.find((p) => p.value === t.purpose)?.label}
                    </p>
                    <h3 className="mt-0.5 font-semibold text-[var(--kb-text)]">
                      {t.asset?.name ?? "On foot"}
                      {t.driver ? ` · ${t.driver.user.name ?? t.driver.user.email}` : ""}
                    </h3>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {t.originText ?? "—"} → {t.destinationText ?? "—"} · started {when(t.startedAt)}
                      {t.odometerStartKm ? ` · odo ${t.odometerStartKm.toLocaleString("en-US")} km` : ""}
                    </p>
                  </div>
                  <span className="kb-pill text-[10px] text-[var(--kb-text-dim)]">{t._count.points} positions</span>
                </div>

                <ol className="mt-3 divide-y divide-[var(--kb-panel-border)] text-sm">
                  {t.stops.map((st) => (
                    <li key={st.id}>
                      <StopCapture
                        tenantId={tenantId}
                        stopId={st.id}
                        label={`${st.sequence + 1}. ${st.party?.name ?? st.label ?? st.addressText ?? "Stop"}`}
                        arrivedAt={st.arrivedAt ? st.arrivedAt.toISOString() : null}
                        departedAt={st.departedAt ? st.departedAt.toISOString() : null}
                        hasProof={Boolean(st.eventId)}
                      />
                    </li>
                  ))}
                </ol>

                <form action={addStopAction.bind(null, tenantId)} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="tripId" value={t.id} />
                  <label className="flex-1 text-xs">
                    <span className="text-[var(--kb-text-dim)]">Add a stop</span>
                    <select name="partyId" className={INPUT} defaultValue="">
                      <option value="">Customer…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1 text-xs">
                    <span className="text-[var(--kb-text-dim)]">or a place</span>
                    <input name="addressText" placeholder="Depot, site, address" className={INPUT} />
                  </label>
                  <SubmitButton className="kb-pill kb-pill-ghost text-xs">Add</SubmitButton>
                </form>
              </div>

              <div className="border-t border-[var(--kb-panel-border)] px-5 py-3">
                <form action={endTripAction.bind(null, tenantId)} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="tripId" value={t.id} />
                  <label className="text-xs">
                    <span className="text-[var(--kb-text-dim)]">Odometer at end</span>
                    <input name="odometerEndKm" type="number" inputMode="numeric" className="kb-input mt-1 w-32 text-sm" placeholder="km" />
                  </label>
                  <label className="text-xs">
                    <span className="text-[var(--kb-text-dim)]">or distance</span>
                    <input name="distanceKm" type="number" step="0.1" inputMode="decimal" className="kb-input mt-1 w-28 text-sm" placeholder="km" />
                  </label>
                  <SubmitButton pendingText="Ending…">End trip</SubmitButton>
                </form>
                <form action={cancelTripAction.bind(null, tenantId)} className="mt-2">
                  <input type="hidden" name="tripId" value={t.id} />
                  <button type="submit" className="text-[11px] text-[var(--kb-text-dim)] underline">Cancel this trip</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* ---- start ------------------------------------------------------ */}
      <section className="kb-card mb-6 px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--kb-text)]">Start a trip</h3>
        <form action={start} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Vehicle</span>
            <select name="assetId" className={INPUT} defaultValue="">
              <option value="">None / on foot</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.registration ? ` (${v.registration})` : ""}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Driver</span>
            <select name="driverId" className={INPUT} defaultValue={access.membershipId ?? ""}>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.user.name ?? d.user.email}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Purpose</span>
            <select name="purpose" className={INPUT} defaultValue="DELIVERY">
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">Odometer at start</span>
            <input name="odometerStartKm" type="number" inputMode="numeric" className={INPUT} placeholder="km" />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">From</span>
            <input name="originText" className={INPUT} placeholder="Depot, Johannesburg" />
          </label>
          <label className="text-xs">
            <span className="text-[var(--kb-text-dim)]">To</span>
            <input name="destinationText" className={INPUT} placeholder="Durban" />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="text-[var(--kb-text-dim)]">First stop</span>
            <div className="flex gap-2">
              <select name="stop0Party" className={INPUT} defaultValue="">
                <option value="">Customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input name="stop0Address" className={INPUT} placeholder="or a place" />
            </div>
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="text-[var(--kb-text-dim)]">Second stop</span>
            <div className="flex gap-2">
              <select name="stop1Party" className={INPUT} defaultValue="">
                <option value="">Customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input name="stop1Address" className={INPUT} placeholder="or a place" />
            </div>
          </label>
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-xs text-[var(--kb-text-dim)]">
              <input type="checkbox" name="planOnly" /> Plan it without starting it
            </label>
            <SubmitButton pendingText="Starting…">Start</SubmitButton>
          </div>
        </form>
      </section>

      {/* ---- history ---------------------------------------------------- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--kb-text)]">Last 30 days</h3>
        {trips.filter((t) => t.status !== "UNDERWAY").length === 0 ? (
          <p className="text-sm text-[var(--kb-text-dim)]">No trips yet. The first one starts above.</p>
        ) : (
          <div className="kb-card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
                <tr className="border-b border-[var(--kb-panel-border)]">
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Vehicle · driver</th>
                  <th className="px-4 py-2">Route</th>
                  <th className="px-4 py-2 text-right">km</th>
                  <th className="px-4 py-2 text-right">Hours</th>
                  <th className="px-4 py-2 text-right">Cost</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kb-panel-border)]">
                {trips
                  .filter((t) => t.status !== "UNDERWAY")
                  .map((t) => {
                    const cost = tripCostCents(t, rates);
                    const tone = STATUS_TONE[t.status];
                    const h = tripHours(t);
                    return (
                      <tr key={t.id}>
                        <td className="px-4 py-2 whitespace-nowrap">{when(t.startedAt ?? t.plannedAt)}</td>
                        <td className="px-4 py-2">
                          {t.asset?.name ?? "On foot"}
                          <span className="block text-xs text-[var(--kb-text-dim)]">{t.driver?.user.name ?? t.driver?.user.email ?? ""}</span>
                        </td>
                        <td className="px-4 py-2">
                          {t.originText ?? "—"} → {t.destinationText ?? "—"}
                          <span className="block text-xs text-[var(--kb-text-dim)]">
                            {t.stops.map((s) => s.party?.name ?? s.label ?? s.addressText).filter(Boolean).join(", ")}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {t.distanceKm !== null ? t.distanceKm.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}
                          {t.distanceSource && <span className="block text-[10px] text-[var(--kb-text-dim)]">{t.distanceSource.toLowerCase()}</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{h !== null ? h.toFixed(1) : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{cost.priced ? money(cost.cents) : <span className="text-[var(--kb-text-dim)]">unpriced</span>}</td>
                        <td className="px-4 py-2">
                          <span className="kb-pill text-[10px]" style={{ background: tone.bg, color: tone.ink }}>{tone.label}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
