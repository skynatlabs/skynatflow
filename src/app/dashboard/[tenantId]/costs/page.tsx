// Costs — what things actually cost, and what work actually earned.
//
// Read top to bottom it answers four questions in order: how much of the
// spending is even recorded (because every figure below depends on it), what
// it costs to move, what each vehicle costs per kilometre, and what each
// customer, job and lane made after all of that. The capture figure comes
// first on purpose: a margin built on two thirds of the costs is confidently
// wrong, and the page should not let anyone read the margin without having
// passed the number that says how wrong.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";
import { captureLedger } from "@/lib/core/captureLedger";
import { assetCosts, customerMargins, fleetCost, jobMargins, laneMargins, lastDays } from "@/lib/core/costing";
import { PageHeader } from "../PageHeader";
import { Figure } from "@/components/dashboard/Figure";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { setAssetCapacityAction, setCostRateAction } from "./actions";

export const dynamic = "force-dynamic";

const CONF: Record<string, { bg: string; ink: string }> = {
  HIGH: { bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  MEDIUM: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  LOW: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
};

const UNIT_WORD: Record<string, string> = { KM: "km", HOUR: "hour", DAY: "day" };

export default async function CostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ days?: string; by?: string }>;
}) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const access = await requireTenantAccess(tenantId);
  const owner = access.role === "OWNER";

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const days = sp.days === "90" ? 90 : sp.days === "365" ? 365 : 30;
  const by = sp.by === "job" ? "job" : sp.by === "lane" ? "lane" : "customer";
  const period = lastDays(days);
  const marginPeriod = lastDays(Math.max(days, 90));

  const [capture, fleet, assets, margins, team, allAssets] = await Promise.all([
    captureLedger(tenantId, period),
    fleetCost(tenantId, period),
    assetCosts(tenantId, period),
    by === "job" ? jobMargins(tenantId, marginPeriod) : by === "lane" ? laneMargins(tenantId, marginPeriod) : customerMargins(tenantId, marginPeriod),
    owner
      ? prisma.membership.findMany({ where: { tenantId }, select: { id: true, costRateCents: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    owner
      ? prisma.asset.findMany({ where: { tenantId, status: { notIn: ["LOST", "RETIRED"] } }, select: { id: true, name: true, capacityUnit: true, registration: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const href = (q: { days?: number; by?: string }) =>
    `/dashboard/${tenantId}/costs?days=${q.days ?? days}&by=${q.by ?? by}`;

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="Costs"
        crumbs={[{ label: "Costs" }]}
        actions={
          <span className="flex gap-1 text-xs">
            {[30, 90, 365].map((d) => (
              <Link key={d} href={href({ days: d })} className={`kb-pill !py-1 ${d === days ? "kb-pill-primary" : "kb-pill-ghost"}`}>
                {d === 365 ? "Year" : `${d} days`}
              </Link>
            ))}
          </span>
        }
      />

      {/* ---- 1. how much is recorded ------------------------------------ */}
      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="kb-card px-5 py-4 md:col-span-2">
          <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Recorded spend</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-3xl leading-none font-semibold tabular-nums text-[var(--kb-text)]">
              {capture.coveragePercent !== null ? `${capture.coveragePercent}%` : money(capture.recordedCents)}
            </span>
            <span className="text-xs text-[var(--kb-text-dim)]">
              {capture.coveragePercent !== null ? `of what left the bank · ${money(capture.recordedCents)} recorded` : "recorded · no bank statement to measure against"}
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--kb-text)]">{capture.summary}</p>
          {capture.bySource.length > 0 && (
            <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
              By route: {capture.bySource.map((s) => `${s.source.toLowerCase().replace("_", " ")} ${money(s.cents)}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="kb-card px-5 py-4">
          <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Gaps</p>
          {capture.gaps.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--kb-text-dim)]">None found for this period.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs">
              {capture.gaps.slice(0, 4).map((g, i) => (
                <li key={i}>
                  <span className="font-medium text-[var(--kb-text)]">{g.label}</span>
                  <span className="block text-[var(--kb-text-dim)]">{g.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- 2. what it costs to move ----------------------------------- */}
      <section className="mb-5 kb-card px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Cost of moving</p>
            <h3 className="mt-1 text-lg font-semibold text-[var(--kb-text)]">
              {fleet.vehicles === 0
                ? "No vehicles set up."
                : `${fleet.vehicles} vehicle${fleet.vehicles === 1 ? "" : "s"} cost ${money(fleet.totalCents)} over ${days} days${fleet.percentOfRevenue !== null ? ` — ${fleet.percentOfRevenue}% of what you invoiced` : ""}.`}
            </h3>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
              {fleet.vehicles === 0
                ? "Mark an asset's capacity as KM below and its costs, trips and fuel start dividing into a figure per kilometre."
                : `${fleet.km.toLocaleString("en-US")} km${fleet.perKmCents ? ` at ${money(fleet.perKmCents)} a kilometre, all in — fuel, upkeep, cover, depreciation and driver hours` : ""}.`}
            </p>
          </div>
        </div>

        {assets.filter((a) => a.capacityUnit).length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
                <tr className="border-b border-[var(--kb-panel-border)]">
                  <th className="py-2 pr-4">Asset</th>
                  <th className="py-2 pr-4 text-right">Direct</th>
                  <th className="py-2 pr-4 text-right">Cover</th>
                  <th className="py-2 pr-4 text-right">Depreciation</th>
                  <th className="py-2 pr-4 text-right">Labour</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 pr-4 text-right">Units</th>
                  <th className="py-2 pr-4 text-right">Per unit</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kb-panel-border)] tabular-nums">
                {assets.filter((a) => a.capacityUnit).map((a) => (
                  <tr key={a.assetId}>
                    <td className="py-2 pr-4">
                      {a.name}
                      <span className="block text-xs text-[var(--kb-text-dim)]">{a.registration ?? ""}{a.tripCount ? ` · ${a.tripCount} trips` : ""}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{money(a.directCents)}</td>
                    <td className="py-2 pr-4 text-right">{money(a.obligationCents)}</td>
                    <td className="py-2 pr-4 text-right">{money(a.depreciationCents)}</td>
                    <td className="py-2 pr-4 text-right">{money(a.labourCents)}</td>
                    <td className="py-2 pr-4 text-right font-semibold">
                      <Figure workings={[
                        { label: "Tagged to it (fuel, repairs, tolls)", value: money(a.directCents) },
                        { label: "Cover and licences, apportioned by day", value: money(a.obligationCents) },
                        { label: "Depreciation, straight line", value: money(a.depreciationCents) },
                        { label: "Driver hours × cost rate", value: money(a.labourCents) },
                      ]}>{money(a.totalCents)}</Figure>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {a.units.toLocaleString("en-US", { maximumFractionDigits: 1 })} {UNIT_WORD[a.capacityUnit!]}
                      <span className="block text-[10px] text-[var(--kb-text-dim)]">{a.unitsSource.toLowerCase()}</span>
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold">
                      {a.costPerUnitCents !== null ? (
                        <Figure
                          workings={[{ label: "Total cost", value: money(a.totalCents) }, { label: `÷ ${UNIT_WORD[a.capacityUnit!]}s`, value: a.units.toLocaleString("en-US", { maximumFractionDigits: 1 }) }]}
                          note={a.unitsSource === "ODOMETER" ? "Kilometres from the lowest and highest odometer readings in the period." : "Units from recorded trips — lower confidence than an odometer."}
                        >{`${money(a.costPerUnitCents)}/${UNIT_WORD[a.capacityUnit!]}`}</Figure>
                      ) : "—"}
                    </td>
                    <td className="py-2">
                      <span className="kb-pill !py-0.5 text-[10px]" style={{ background: CONF[a.confidence].bg, color: CONF[a.confidence].ink }}>
                        {a.confidence.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 3. margin ----------------------------------------------------- */}
      <section className="mb-5 kb-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">Margin, last {Math.max(days, 90)} days</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--kb-text)]">What work earned after goods, tagged costs and its share of travel. Worst first.</h3>
          </div>
          <span className="flex gap-1 text-xs">
            {(["customer", "job", "lane"] as const).map((b) => (
              <Link key={b} href={href({ by: b })} className={`kb-pill !py-1 ${b === by ? "kb-pill-primary" : "kb-pill-ghost"}`}>
                By {b}
              </Link>
            ))}
          </span>
        </div>

        {margins.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--kb-text-dim)]">
            {by === "lane" ? "No completed trips with a from and to yet." : "No invoices in the period."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">
                <tr className="border-b border-[var(--kb-panel-border)]">
                  <th className="py-2 pr-4">{by === "lane" ? "Lane" : by === "job" ? "Invoice" : "Customer"}</th>
                  <th className="py-2 pr-4 text-right">{by === "lane" ? "Runs · km" : "Jobs"}</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 pr-4 text-right">Margin</th>
                  <th className="py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kb-panel-border)] tabular-nums">
                {margins.slice(0, 40).map((m) => {
                  const row =
                    "laneKey" in m
                      ? { key: m.laneKey, label: m.laneKey, count: `${m.trips} · ${m.km} km`, revenue: m.revenueCents, cost: m.costCents, margin: m.marginCents, pct: m.revenueCents > 0 ? Math.round((m.marginCents / m.revenueCents) * 100) : null, priced: m.priced, unlinked: m.linkedStops === 0 ? m.stops : 0 }
                      : "transactionId" in m
                        ? { key: m.transactionId, label: `${m.partyName} · ${m.date.toISOString().slice(0, 10)}`, count: "1", revenue: m.revenueCents, cost: m.cogsCents + m.directCents + m.travelCents, margin: m.marginCents, pct: m.marginPercent, priced: m.travelPriced, unlinked: 0 }
                        : { key: m.partyId, label: m.partyName, count: String(m.jobs), revenue: m.revenueCents, cost: m.costCents, margin: m.marginCents, pct: m.marginPercent, priced: m.travelPriced, unlinked: 0 };
                  return (
                    <tr key={row.key}>
                      <td className="py-2 pr-4">
                        {row.label}
                        {!row.priced && <span className="block text-[10px] text-[var(--kb-tint-peach-ink)]">some travel unpriced — margin overstated</span>}
                        {row.unlinked > 0 && <span className="block text-[10px] text-[var(--kb-text-dim)]">no invoice linked to any of its {row.unlinked} stops — revenue unknown, not nil</span>}
                      </td>
                      <td className="py-2 pr-4 text-right">{row.count}</td>
                      <td className="py-2 pr-4 text-right">{money(row.revenue)}</td>
                      <td className="py-2 pr-4 text-right">{money(row.cost)}</td>
                      <td className="py-2 pr-4 text-right font-semibold" style={{ color: row.margin < 0 ? "var(--kb-tint-peach-ink)" : "var(--kb-text)" }}>{money(row.margin)}</td>
                      <td className="py-2 text-right">{row.pct !== null ? `${row.pct}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 4. the inputs (owner) ----------------------------------------- */}
      {owner && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="kb-card px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">What one unit of each asset is</h3>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">KM for a vehicle, HOUR for a machine, DAY for a crew. Without one, no per-unit figure is produced for it.</p>
            <div className="mt-3 space-y-2">
              {allAssets.map((a) => (
                <form key={a.id} action={setAssetCapacityAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2 text-xs">
                  <input type="hidden" name="assetId" value={a.id} />
                  <span className="min-w-32 flex-1 text-[var(--kb-text)]">{a.name}</span>
                  <select name="capacityUnit" defaultValue={a.capacityUnit ?? ""} className="kb-input text-xs">
                    <option value="">—</option>
                    <option value="KM">per km</option>
                    <option value="HOUR">per hour</option>
                    <option value="DAY">per day</option>
                  </select>
                  <input name="registration" defaultValue={a.registration ?? ""} placeholder="Plate / serial" className="kb-input w-28 text-xs" />
                  <SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Save</SubmitButton>
                </form>
              ))}
              {allAssets.length === 0 && <p className="text-xs text-[var(--kb-text-dim)]">No assets yet — add vehicles and machines on the assets page.</p>}
            </div>
          </div>
          <div className="kb-card px-5 py-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">What an hour of each person costs</h3>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Their cost to the business, including on-costs — not their pay. Multiplied by trip hours for the labour line above. Only you see this.</p>
            <div className="mt-3 space-y-2">
              {team.map((m) => (
                <form key={m.id} action={setCostRateAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2 text-xs">
                  <input type="hidden" name="membershipId" value={m.id} />
                  <span className="min-w-32 flex-1 text-[var(--kb-text)]">{m.user.name ?? m.user.email}</span>
                  <input name="ratePerHour" type="number" step="0.01" inputMode="decimal" defaultValue={m.costRateCents !== null ? (m.costRateCents / 100).toFixed(2) : ""} placeholder="per hour" className="kb-input w-28 text-xs" />
                  <SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Save</SubmitButton>
                </form>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
