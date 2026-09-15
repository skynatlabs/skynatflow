// The efficiency consultant.
//
// Where the same money is being spent twice, and what could be consolidated.
// It runs the consolidation engine and carries what it finds to the bus, plus
// the two travel findings — a route that would have been shorter in another
// order, a customer whose jobs always overrun their quote — and the one
// number a business that does not think of itself as a logistics company
// has never seen: what its vehicles cost as a share of what it invoices.
//
// Deterministic, like the CFO and for the same reasons. A saving is
// arithmetic over slips, trips and policies, and the honest thing about an
// assumption is to name it, which a template does more reliably than prose.
// Each check catches its own failure so one broken source never costs the
// others, and runEfficiency() says which ones failed.

import { prisma } from "@/lib/db";
import { observe, handOff, type ObserveParams } from "../observations";
import { consolidationReport, EFFORT_LABEL } from "@/lib/core/consolidation";
import { routeWaste, siteTimeOverruns } from "@/lib/core/travelEfficiency";
import { costRates, fleetCost, lastDays } from "@/lib/core/costing";
import { captureLedger } from "@/lib/core/captureLedger";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;

/** The consolidation engine's ranked list, top few only — the bus ranks the rest of the day. */
async function consolidation(tenantId: string): Promise<Finding[]> {
  const report = await consolidationReport(tenantId);
  return report.savings.slice(0, 5).map((s) => ({
    headline: s.headline,
    detail: s.detail,
    dedupeKey: s.key,
    moneyCents: s.annualCents,
    confidence: s.confidence,
    evidence: [{ label: "Effort", value: EFFORT_LABEL[s.effort] }, ...s.evidence],
    proposedAction: s.proposedAction,
    subjectType: s.subjectType ?? null,
    subjectId: s.subjectId ?? null,
  }));
}

async function routeOrder(tenantId: string): Promise<Finding | null> {
  const period = lastDays(30);
  const [waste, rates, currency] = await Promise.all([
    routeWaste(tenantId, period),
    costRates(tenantId, period),
    tenantCurrency(tenantId),
  ]);
  const worst = waste[0];
  if (!worst) return null;
  const perKm = rates.fleetPerKmCents;
  const cents = perKm ? Math.round(worst.wastedKm * perKm) : null;
  const when = worst.date.toISOString().slice(0, 10);
  return {
    headline: `${when}'s ${worst.stops} stops, driven in a different order, would have been ${worst.wastedKm} km shorter.`,
    detail: `${worst.drivenKm} km was driven; ${worst.bestKm} km would have covered the same stops${worst.driverName ? ` (${worst.driverName})` : ""}. Order: ${worst.bestOrder.join(" → ")}.${cents ? ` At this fleet's ${formatMoney(perKm!, currency)} a kilometre that is ${formatMoney(cents, currency)} on one day.` : ""}`,
    dedupeKey: `eff:route:${worst.tripId}`,
    subjectType: "trip",
    subjectId: worst.tripId,
    moneyCents: cents,
    confidence: 60,
    evidence: [
      { label: "Driven", value: `${worst.drivenKm} km` },
      { label: "Best found", value: `${worst.bestKm} km` },
      { label: "Wasted", value: `${worst.wastedKm} km (${worst.wastedPercent}%)` },
    ],
    proposedAction: "Plan multi-stop days by area before leaving — the COO can order the stops for a driver each morning.",
  };
}

async function siteTime(tenantId: string): Promise<Finding | null> {
  const [overruns, currency, rates] = await Promise.all([
    siteTimeOverruns(tenantId, lastDays(90)),
    tenantCurrency(tenantId),
    prisma.membership.aggregate({ where: { tenantId, costRateCents: { not: null } }, _avg: { costRateCents: true } }),
  ]);
  const worst = overruns[0];
  if (!worst) return null;
  const rate = rates._avg.costRateCents;
  const cents = rate ? Math.round(worst.overrunHours * rate) : null;
  return {
    headline: `${worst.partyName}'s jobs take ${worst.overrunPercent}% longer on site than they are quoted — ${worst.overrunHours} hours over ${worst.visits} visits.`,
    detail: `${worst.quotedHours} hours were quoted, ${worst.actualHours} were spent on site. One long visit is a bad day; ${worst.visits} of them is a price that is wrong.${cents ? ` At the team's average cost that is ${formatMoney(cents, currency)} given away.` : " Set staff cost rates to put a figure on it."}`,
    dedupeKey: `eff:site-time:${worst.partyId}`,
    subjectType: "customer",
    subjectId: worst.partyId,
    moneyCents: cents,
    confidence: 65,
    evidence: [
      { label: "Quoted", value: `${worst.quotedHours} h` },
      { label: "On site", value: `${worst.actualHours} h` },
      { label: "Visits", value: String(worst.visits) },
    ],
    proposedAction: `Quote ${worst.partyName} the hours the work actually takes. The sales consultant can draft the next quote at the real figure.`,
  };
}

/** Phase 181: the fleet cost a non-logistics business does not know it has. */
async function fleetShare(tenantId: string): Promise<Finding | null> {
  const period = lastDays(30);
  const [fleet, currency] = await Promise.all([fleetCost(tenantId, period), tenantCurrency(tenantId)]);
  if (fleet.vehicles === 0 || fleet.totalCents === 0) return null;
  if (fleet.percentOfRevenue === null || fleet.percentOfRevenue < 12) return null;
  const strongest = fleet.byAsset.reduce<"HIGH" | "MEDIUM" | "LOW">(
    (acc, a) => (a.confidence === "HIGH" ? "HIGH" : acc === "HIGH" ? "HIGH" : a.confidence === "MEDIUM" ? "MEDIUM" : acc),
    "LOW"
  );
  return {
    headline: `Your ${fleet.vehicles} vehicle${fleet.vehicles === 1 ? "" : "s"} cost ${formatMoney(fleet.totalCents, currency)} last month — ${fleet.percentOfRevenue}% of what you invoiced.`,
    detail: `${fleet.km.toLocaleString("en-US")} km${fleet.perKmCents ? ` at ${formatMoney(fleet.perKmCents, currency)} a kilometre, all in — fuel, upkeep, cover, depreciation and the driver's hours` : ""}. A business that does not sell transport still pays for it; this is what it pays.`,
    dedupeKey: "eff:fleet-share",
    moneyCents: fleet.totalCents,
    confidence: strongest === "HIGH" ? 80 : strongest === "MEDIUM" ? 60 : 40,
    evidence: fleet.byAsset.slice(0, 5).map((a) => ({
      label: a.name,
      value: `${formatMoney(a.totalCents, currency)}${a.costPerUnitCents ? `, ${formatMoney(a.costPerUnitCents, currency)}/km` : ""} (${a.confidence.toLowerCase()} confidence)`,
    })),
    proposedAction: "Read the cost page: the per-kilometre figure per vehicle says which one is expensive and why.",
  };
}

/** Vehicles that moved and recorded no cost — slips in a glovebox, not in the books. */
async function vehicleGaps(tenantId: string): Promise<Finding[]> {
  const ledger = await captureLedger(tenantId);
  return ledger.gaps
    .filter((g) => g.kind === "VEHICLE_NO_FUEL" && g.subjectId)
    .slice(0, 3)
    .map((g) => ({
      headline: g.label + ".",
      detail: g.detail,
      dedupeKey: `eff:capture:asset:${g.subjectId}`,
      subjectType: "asset",
      subjectId: g.subjectId!,
      moneyCents: null,
      confidence: 90,
      evidence: [],
      proposedAction: "Ask the driver for the slips, or have them photograph each one at the pump — it takes less time than losing it.",
    }));
}

/**
 * Phase 163: a job done by hand, the same way, every month. Invoices typed
 * for the same customer at the same amount three months running, with no
 * recurring invoice set up — work the platform could be doing.
 */
async function manualRepeats(tenantId: string): Promise<Finding[]> {
  const since = new Date(Date.now() - 120 * 86_400_000);
  const invoices = await prisma.transaction.findMany({
    where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: since } },
    select: { partyId: true, amountCents: true, createdAt: true, party: { select: { name: true } } },
  });
  const recurring = new Set((await prisma.recurringInvoice.findMany({ where: { tenantId, isActive: true }, select: { partyId: true } })).map((r) => r.partyId));
  const by = new Map<string, typeof invoices>();
  for (const i of invoices) {
    const key = `${i.partyId}|${Math.round(i.amountCents / 100)}`;
    by.set(key, [...(by.get(key) ?? []), i]);
  }
  const out: Finding[] = [];
  for (const [key, list] of by) {
    const partyId = key.split("|")[0];
    if (recurring.has(partyId)) continue;
    const months = new Set(list.map((i) => i.createdAt.toISOString().slice(0, 7)));
    if (months.size < 3) continue;
    out.push({
      headline: `${list[0].party.name} has been invoiced the same amount by hand ${months.size} months running.`,
      detail: "Somebody types this invoice every month. A recurring invoice would raise it on the day, every month, and nobody would have to remember.",
      dedupeKey: `eff:manual-repeat:${partyId}`,
      subjectType: "customer",
      subjectId: partyId,
      moneyCents: null,
      confidence: 85,
      evidence: [{ label: "Months", value: [...months].sort().join(", ") }],
      proposedAction: "Turn it into a recurring invoice.",
    });
  }
  return out.slice(0, 3);
}

const CHECKS: Array<{ name: string; run: (t: string) => Promise<Finding[] | Finding | null> }> = [
  { name: "manualRepeats", run: manualRepeats },
  { name: "consolidation", run: consolidation },
  { name: "routeOrder", run: routeOrder },
  { name: "siteTime", run: siteTime },
  { name: "fleetShare", run: fleetShare },
  { name: "vehicleGaps", run: vehicleGaps },
];

export interface EfficiencyRun {
  checked: number;
  observed: number;
  failed: string[];
}

export async function runEfficiency(tenantId: string): Promise<EfficiencyRun> {
  let observed = 0;
  const failed: string[] = [];
  for (const check of CHECKS) {
    try {
      const result = await check.run(tenantId);
      const findings = result === null ? [] : Array.isArray(result) ? result : [result];
      for (const f of findings) {
        const written = await observe({ ...f, tenantId, officer: "EFFICIENCY" });
        if (written) {
          observed++;
          if (f.dedupeKey.startsWith("eff:site-time:")) {
            await handOff({ tenantId, observationId: written.id, to: "SALES", note: "Handed to sales: the next quote should carry the real hours." }).catch(() => undefined);
          }
        }
      }
    } catch (err) {
      failed.push(check.name);
      console.error(`[efficiency] ${check.name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: CHECKS.length, observed, failed };
}
