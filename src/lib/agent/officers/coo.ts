// The chief operating officer.
//
// Dispatch, jobs, vehicles, stock and who is on duty. The only officer that
// may act unasked, and only on what can be undone: when its ceiling is ACT
// it books the service a vehicle is due for as a task, because a task can be
// deleted and a missed service cannot. Everything else it raises.
//
// Deterministic, like the CFO. A vehicle 400 km from its service interval is
// arithmetic, and a lapsed permit on a subcontractor is a date.

import { prisma } from "@/lib/db";
import { observe, type ObserveParams } from "../observations";
import { may } from "../ladder";
import { createTask } from "@/lib/core/tasks";
import {
  detentionOwed,
  unbilledRecoverables,
  emptyRunning,
  fuelConsumption,
  maintenanceDue,
  overloadedTrips,
  subcontractorsAtRisk,
  routeDeviations,
} from "@/lib/core/fleetOps";
import { costRates, lastDays } from "@/lib/core/costing";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;
type Check = (tenantId: string, money: (c: number) => string) => Promise<Finding[] | Finding | null>;

const detention: Check = async (tenantId, money) => {
  const lines = (await detentionOwed(tenantId)).filter((l) => !l.billed);
  if (lines.length === 0) return null;
  const priced = lines.filter((l) => l.cents);
  const total = priced.reduce((s, l) => s + (l.cents ?? 0), 0);
  const minutes = lines.reduce((s, l) => s + l.billableMinutes, 0);
  const worst = [...lines].sort((a, b) => b.billableMinutes - a.billableMinutes)[0];
  return {
    headline: total > 0
      ? `${money(total)} of standing time was given away — ${Math.round(minutes / 60)} hours at customers' gates beyond the free allowance.`
      : `${Math.round(minutes / 60)} hours of standing time beyond the free allowance, not billed — set a detention rate to put a figure on it.`,
    detail: `${lines.length} stop${lines.length === 1 ? "" : "s"}; the longest was ${worst.partyName}, ${worst.onSiteMinutes} minutes on site. The arrival and departure times are recorded, which is what defends the charge.`,
    dedupeKey: "coo:detention",
    moneyCents: total || null,
    confidence: 90,
    evidence: lines.slice(0, 4).map((l) => ({ label: l.partyName, value: `${l.arrivedAt.toISOString().slice(0, 16).replace("T", " ")} → ${l.departedAt.toISOString().slice(11, 16)}, ${l.billableMinutes} min billable` })),
    proposedAction: "Bill it — each stop becomes a draft invoice line with the times on it, for you to check before it goes.",
  };
};

const recoverables: Check = async (tenantId, money) => {
  const rows = await unbilledRecoverables(tenantId);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const noCustomer = rows.filter((r) => !r.transaction).length;
  return {
    headline: `${money(total)} of tolls, permits and materials the customer should pay back has not reached an invoice.`,
    detail: `${rows.length} cost${rows.length === 1 ? "" : "s"} marked recoverable${noCustomer ? `, ${noCustomer} not yet tagged to a customer's document` : ""}. Every one left unbilled is a cost the business carries for someone else.`,
    dedupeKey: "coo:recoverables",
    moneyCents: total,
    confidence: 95,
    evidence: rows.slice(0, 4).map((r) => ({ label: r.descriptionText, value: `${money(r.amountCents)}${r.transaction ? ` · ${r.transaction.party.name}` : " · no customer"}` })),
    proposedAction: "Bill them — one draft invoice per customer, for you to check.",
  };
};

const emptyLegs: Check = async (tenantId, money) => {
  const [legs, rates] = await Promise.all([emptyRunning(tenantId), costRates(tenantId, lastDays(90))]);
  if (legs.length === 0) return null;
  const km = legs.reduce((s, l) => s + (l.kmFromBase ?? 0), 0);
  const cents = rates.fleetPerKmCents && km ? Math.round(km * rates.fleetPerKmCents) : null;
  return {
    headline: `${legs.length} run${legs.length === 1 ? "" : "s"} ended away from base with nothing to bring back${cents ? ` — roughly ${money(cents)} of empty kilometres` : ""}.`,
    detail: `Each came back empty or has not come back loaded within three days. A return load, even at a thin rate, beats paying to drive the vehicle home.`,
    dedupeKey: "coo:empty-running",
    moneyCents: cents,
    confidence: 60,
    evidence: legs.slice(0, 4).map((l) => ({ label: l.assetName, value: `${l.destination} on ${l.endedAt.toISOString().slice(0, 10)}${l.kmFromBase ? `, ${l.kmFromBase} km from base` : ""}` })),
    proposedAction: "Before the next run to these places, ask the sales consultant for a customer there who needs something moved back.",
  };
};

const fuelPattern: Check = async (tenantId) => {
  const rows = (await fuelConsumption(tenantId)).filter((r) => r.deviationPercent !== null && r.deviationPercent >= 15);
  return rows.slice(0, 2).map((r) => ({
    headline: `${r.assetName} is using ${r.deviationPercent}% more fuel per 100 km over its last four fills than it did before.`,
    detail: `${r.per100} L/100 km overall across ${r.fills} fills. One tank proves nothing; four in a row is a pattern — a fault, a route change, or fuel not going into the vehicle.`,
    dedupeKey: `coo:fuel:${r.assetId}`,
    subjectType: "asset",
    subjectId: r.assetId,
    moneyCents: null,
    confidence: 65,
    evidence: [
      { label: "Overall", value: `${r.per100} L/100 km` },
      { label: "Recent change", value: `+${r.deviationPercent}%` },
      { label: "Fills read", value: String(r.fills) },
    ],
    proposedAction: "Check tyre pressures and the injectors first; if the vehicle is fine, compare the fill-ups against the fuel card statement.",
  }));
};

const service: Check = async (tenantId) => {
  const due = await maintenanceDue(tenantId);
  if (due.length === 0) return null;
  const findings: Finding[] = [];
  const canAct = await may(tenantId, "COO", "ACT");
  for (const d of due.slice(0, 3)) {
    let booked = false;
    if (canAct) {
      const title = `Service ${d.assetName} (due at ${d.dueAtKm.toLocaleString("en-US")} km)`;
      const exists = await prisma.task.findFirst({ where: { tenantId, title, status: { not: "DONE" } }, select: { id: true } });
      if (!exists) {
        // Reversible: a task is deleted with one click. This is the only kind
        // of thing an officer may do without asking.
        await createTask({ tenantId, title, description: `Odometer ${d.odometerKm.toLocaleString("en-US")} km. Booked by the COO.`, dueAt: d.daysRemaining !== null ? new Date(Date.now() + Math.max(1, d.daysRemaining - 3) * 86_400_000) : undefined });
        booked = true;
      }
    }
    findings.push({
      headline: d.kmRemaining <= 0
        ? `${d.assetName} is ${Math.abs(d.kmRemaining).toLocaleString("en-US")} km past its service.`
        : `${d.assetName} is due a service in ${d.kmRemaining.toLocaleString("en-US")} km${d.daysRemaining !== null ? ` — about ${d.daysRemaining} days at its current use` : ""}.`,
      detail: booked ? "I have put the service on the task list; delete it if you have it in hand." : "Slot it into a gap on the dispatch board before it becomes a breakdown on a run.",
      dedupeKey: `coo:service:${d.assetId}`,
      subjectType: "asset",
      subjectId: d.assetId,
      moneyCents: null,
      confidence: 95,
      urgentBy: d.daysRemaining !== null ? new Date(Date.now() + d.daysRemaining * 86_400_000) : null,
      evidence: [{ label: "Odometer", value: `${d.odometerKm.toLocaleString("en-US")} km` }, { label: "Due at", value: `${d.dueAtKm.toLocaleString("en-US")} km` }],
      proposedAction: booked ? "Nothing — it is booked." : "Book the service.",
    });
  }
  return findings;
};

const overload: Check = async (tenantId) => {
  const over = await overloadedTrips(tenantId);
  return over.slice(0, 2).map((o) => ({
    headline: `${o.assetName}'s planned run peaks at ${o.peakGrossKg.toLocaleString("en-US")} kg — ${o.overKg.toLocaleString("en-US")} kg over what it may carry.`,
    detail: `Tare ${o.tareKg.toLocaleString("en-US")} kg plus a peak payload of ${o.peakPayloadKg.toLocaleString("en-US")} kg, against a permissible ${o.maxGrossKg.toLocaleString("en-US")} kg. Found before dispatch, not at the weighbridge.`,
    dedupeKey: `coo:overload:${o.tripId}`,
    subjectType: "trip",
    subjectId: o.tripId,
    moneyCents: null,
    confidence: 90,
    evidence: [{ label: "Peak gross", value: `${o.peakGrossKg} kg` }, { label: "Permissible", value: `${o.maxGrossKg} kg` }],
    proposedAction: "Split the load across two runs or reorder the stops so drops come before pickups.",
  }));
};

const subcontractors: Check = async (tenantId) => {
  const risky = await subcontractorsAtRisk(tenantId);
  return risky.slice(0, 3).map((r) => ({
    headline: r.lapsed.length > 0
      ? `${r.name}'s ${r.lapsed[0].title} lapsed ${r.lapsed[0].daysOverdue} days ago — they cannot be dispatched until it is renewed.`
      : `${r.name} drives for you with no insurance, licence or permit on record.`,
    detail: r.lapsed.length > 0
      ? `An owner-driver's lapsed cover becomes your liability the moment something goes wrong. ${r.lapsed[0].consequence ?? ""}`.trim()
      : "Their cover is your exposure. Ask for the certificate and record it with its expiry.",
    dedupeKey: `coo:subcontractor:${r.partyId}`,
    subjectType: "customer",
    subjectId: r.partyId,
    moneyCents: null,
    confidence: 95,
    evidence: r.lapsed.map((l) => ({ label: l.title, value: `due ${l.dueAt.toISOString().slice(0, 10)}` })),
    proposedAction: "Get the renewed document before their next run.",
  }));
};

const deviations: Check = async (tenantId) => {
  const devs = await routeDeviations(tenantId);
  return devs.slice(0, 2).map((d) => ({
    headline: `A run on ${d.laneKey} was ${d.deviationPercent}% longer than that lane usually is — ${d.distanceKm} km against ${d.laneMedianKm}.`,
    detail: `Measured against ${d.runsOnLane} earlier runs on the same lane, beyond its normal spread. Most deviations have a reason; this one is unusual enough to ask.`,
    dedupeKey: `coo:deviation:${d.tripId}`,
    subjectType: "trip",
    subjectId: d.tripId,
    moneyCents: null,
    confidence: 55,
    evidence: [{ label: "This run", value: `${d.distanceKm} km` }, { label: "Lane usually", value: `${d.laneMedianKm} km` }],
    proposedAction: "Ask the driver what happened — a closure, a detour, or a stop that was not on the sheet.",
  }));
};

const overdueJobs: Check = async (tenantId) => {
  const stale = await prisma.jobCard.findMany({
    where: { tenantId, status: { not: "DONE" }, scheduledAt: { lt: new Date(Date.now() - 2 * 86_400_000) } },
    select: { id: true, title: true, scheduledAt: true, party: { select: { name: true } } },
    take: 20,
  });
  if (stale.length === 0) return null;
  return {
    headline: `${stale.length} job${stale.length === 1 ? " was" : "s were"} scheduled more than two days ago and never marked done.`,
    detail: "Either the work was done and nobody closed the card — so it was never invoiced — or it was not done and the customer is waiting.",
    dedupeKey: "coo:overdue-jobs",
    moneyCents: null,
    confidence: 80,
    evidence: stale.slice(0, 4).map((j) => ({ label: j.title, value: `${j.party.name}, ${j.scheduledAt!.toISOString().slice(0, 10)}` })),
    proposedAction: "Close the ones that are done so they can be invoiced; reschedule the rest.",
  };
};

const CHECKS: Array<{ name: string; run: Check }> = [
  { name: "detention", run: detention },
  { name: "recoverables", run: recoverables },
  { name: "emptyRunning", run: emptyLegs },
  { name: "fuelPattern", run: fuelPattern },
  { name: "service", run: service },
  { name: "overload", run: overload },
  { name: "subcontractors", run: subcontractors },
  { name: "deviations", run: deviations },
  { name: "overdueJobs", run: overdueJobs },
];

export async function runCOO(tenantId: string): Promise<{ checked: number; observed: number; failed: string[] }> {
  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);
  let observed = 0;
  const failed: string[] = [];
  for (const check of CHECKS) {
    try {
      const r = await check.run(tenantId, money);
      for (const f of r === null ? [] : Array.isArray(r) ? r : [r]) {
        if (await observe({ ...f, tenantId, officer: "COO" })) observed++;
      }
    } catch (err) {
      failed.push(check.name);
      console.error(`[coo] ${check.name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: CHECKS.length, observed, failed };
}
