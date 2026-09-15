// The first ninety days — appointing executives, not buying software.
//
// 191 The arrival. Signing up should feel like six executives starting on
//     Monday: each introduces itself by what it found in the business's own
//     data within the hour, not by a feature tour. runArrival() sets every
//     officer to work at once and hands back one introduction each — a real
//     finding if there is one, and otherwise exactly what it needs to start.
//
// 192 The first audit. A deliberate deep read in week one: leakage, uncosted
//     work, compliance exposure, contracts renewing, money being held. The
//     report a consultant would charge for, produced before anybody has
//     finished setting up.
//
// 193 Ninety days, measured. At day thirty, sixty and ninety, unprompted:
//     what was found, what was taken on, what it was worth, against what the
//     platform cost.

import { Officer } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runCFO } from "./officers/cfo";
import { runCOO } from "./officers/coo";
import { runSales } from "./officers/sales";
import { runLegal, tenderReadiness } from "./officers/legal";
import { runEfficiency } from "./officers/efficiency";
import { runCEO } from "./officers/ceo";
import { runComplianceWatch } from "./complianceWatch";
import { packFor } from "@/lib/core/industryPacks";
import { captureLedger } from "@/lib/core/captureLedger";
import { consolidationReport } from "@/lib/core/consolidation";
import { customerMargins, lastDays } from "@/lib/core/costing";
import { detentionOwed, unbilledRecoverables } from "@/lib/core/fleetOps";
import { retentionHeld } from "@/lib/core/progressBilling";
import { valueSummary } from "@/lib/core/valueLedger";
import { createNotification } from "@/lib/core/notifications2";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

const DAY = 86_400_000;

export const OFFICER_INTRO: Record<Exclude<Officer, "SYSTEM">, { name: string; role: string; needs: string }> = {
  CEO: { name: "Chief Executive", role: "Which customers to keep, which work to stop, where the next hire or vehicle pays for itself.", needs: "Three months of invoices, and costs tagged to the work they were for." },
  CFO: { name: "Chief Financial Officer", role: "The books, the bank, cash ahead, debtors, margin, tax and leakage.", needs: "A bank statement imported and the invoices you have already sent." },
  COO: { name: "Chief Operating Officer", role: "Jobs, trips, vehicles, stock and who is on duty. The only one of us that may act unasked — and only on what can be undone.", needs: "Your vehicles and machines on the asset register, and trips or job cards as work happens." },
  LEGAL: { name: "Legal Counsel", role: "Renewals, licences, contract notice windows, and what a tender will ask for.", needs: "Your compliance calendar — renewals and certificates with their dates." },
  SALES: { name: "Sales Consultant", role: "Quotes going cold, customers going quiet, discounting, and what to say to them. Drafts every message; sends none.", needs: "The quotes you send, so I can see which are read and not answered." },
  EFFICIENCY: { name: "Efficiency Consultant", role: "The same money spent twice, work done by hand that could run itself, and what could be consolidated.", needs: "Slips with line items and your recurring payments — a bank statement shows those." },
};

export interface Introduction {
  officer: Exclude<Officer, "SYSTEM">;
  name: string;
  role: string;
  watches: string | null;
  finding: { headline: string; moneyCents: number | null; confidence: number } | null;
  needs: string;
}

/** Set all six to work at once and collect one introduction from each. */
export async function runArrival(tenantId: string, now = new Date()): Promise<Introduction[]> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { niche: true } });
  const pack = packFor(tenant?.niche ?? "SERVICES");

  const started = new Date(now.getTime() - 1000);
  // Each in its own try: an officer that cannot read something yet still
  // introduces itself, with what it needs.
  const runs: Array<Promise<unknown>> = [
    runComplianceWatch(tenantId, now),
    runCFO(tenantId),
    runCOO(tenantId),
    runSales(tenantId, now),
    runLegal(tenantId, now),
    runEfficiency(tenantId),
    runCEO(tenantId, { now, force: true, phrase: false }),
  ];
  await Promise.allSettled(runs);

  const fresh = await prisma.observation.findMany({
    where: { tenantId, status: { in: ["OPEN", "RAISED"] }, createdAt: { gte: new Date(started.getTime() - 5 * 60_000) } },
    orderBy: [{ moneyCents: { sort: "desc", nulls: "last" } }, { confidence: "desc" }],
  });
  const all = fresh.length > 0 ? fresh : await prisma.observation.findMany({
    where: { tenantId, status: { in: ["OPEN", "RAISED"] } },
    orderBy: [{ moneyCents: { sort: "desc", nulls: "last" } }, { confidence: "desc" }],
    take: 50,
  });

  // An introduction leads with money found, not with a chore: "your books
  // are behind" is true and useful, but "R20 000 is overdue from Late Payer"
  // is what makes someone believe the officer is worth listening to.
  const CHORES = ["cfo:books-behind", "cfo:capture-gap", "cfo:unclassified-spend", "legal:should-block", "eff:capture:"];
  const weight = (o: (typeof all)[number]) =>
    (o.moneyCents ?? 0) * (o.confidence / 100) * (CHORES.some((c) => o.dedupeKey.startsWith(c)) ? 0.25 : 1);

  return (Object.keys(OFFICER_INTRO) as Array<Exclude<Officer, "SYSTEM">>).map((officer) => {
    const intro = OFFICER_INTRO[officer];
    const own = all
      .filter((o) => (o.handedTo ?? o.officer) === officer || (officer === "LEGAL" && o.officer === "SYSTEM"))
      .sort((a, b) => weight(b) - weight(a))[0];
    return {
      officer,
      name: intro.name,
      role: intro.role,
      watches: pack.watches[officer] ?? null,
      finding: own ? { headline: own.headline, moneyCents: own.moneyCents, confidence: own.confidence } : null,
      needs: intro.needs,
    };
  });
}

export async function markArrivalShown(tenantId: string) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { arrivalShownAt: new Date() } });
}

// ------------------------------------------------------------------ 192

export interface AuditSection {
  key: "leakage" | "uncosted" | "compliance" | "contracts" | "held";
  title: string;
  lines: Array<{ label: string; value: string }>;
  cents: number;
  summary: string;
}

export interface FirstAudit {
  generatedAt: Date;
  sections: AuditSection[];
  totalCents: number;
  headline: string;
}

export async function firstAudit(tenantId: string, now = new Date()): Promise<FirstAudit> {
  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);

  const [capture, consolidation, margins, detention, recoverables, tender, contracts, retention, overdue] = await Promise.all([
    captureLedger(tenantId, { from: new Date(now.getTime() - 90 * DAY), to: now }),
    consolidationReport(tenantId, { now }),
    customerMargins(tenantId, lastDays(180, now)),
    detentionOwed(tenantId),
    unbilledRecoverables(tenantId),
    tenderReadiness(tenantId, now),
    prisma.obligation.findMany({ where: { tenantId, status: "OPEN", kind: "CONTRACT", dueAt: { lte: new Date(now.getTime() + 90 * DAY) } }, select: { title: true, dueAt: true, noticeDays: true, amountCents: true } }),
    retentionHeld(tenantId).catch(() => null),
    prisma.transaction.aggregate({ where: { tenantId, type: "INVOICE", status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] }, dueAt: { lt: now } }, _sum: { amountCents: true }, _count: true }),
  ]);

  const sections: AuditSection[] = [];

  const leakCents = consolidation.weightedAnnualCents + capture.unexplainedCents;
  sections.push({
    key: "leakage",
    title: "Money leaking",
    cents: leakCents,
    lines: [
      ...(capture.hasBankFeed ? [{ label: "Left the bank, recorded nowhere (90 days)", value: money(capture.unexplainedCents) }] : [{ label: "Unrecorded spend", value: "unknown — no bank statement yet" }]),
      ...consolidation.savings.slice(0, 5).map((s) => ({ label: s.headline, value: `${money(s.annualCents)}/yr` })),
    ],
    summary: consolidation.savings.length || capture.unexplainedCents
      ? `${money(leakCents)} identified, weighted by confidence.`
      : "Nothing found yet — the engine needs slips, a bank statement and recurring payments to read.",
  });

  const losers = margins.filter((m) => m.marginCents < 0);
  const detentionCents = detention.filter((d) => !d.billed).reduce((s, d) => s + (d.cents ?? 0), 0);
  const recoverableCents = recoverables.reduce((s, r) => s + r.amountCents, 0);
  sections.push({
    key: "uncosted",
    title: "Work that did not pay",
    cents: losers.reduce((s, m) => s + Math.abs(m.marginCents), 0) + detentionCents + recoverableCents,
    lines: [
      ...losers.slice(0, 5).map((m) => ({ label: `${m.partyName} — cost more to serve than paid`, value: money(m.marginCents) })),
      ...(detentionCents ? [{ label: "Standing time not billed", value: money(detentionCents) }] : []),
      ...(recoverableCents ? [{ label: "Recoverable costs not invoiced", value: money(recoverableCents) }] : []),
    ],
    summary: losers.length ? `${losers.length} customer${losers.length === 1 ? "" : "s"} lost money over six months.` : "No customer was served at a loss in the costs recorded so far.",
  });

  const stale = [...tender.lapsed, ...tender.expiring];
  sections.push({
    key: "compliance",
    title: "Compliance exposure",
    cents: 0,
    lines: stale.slice(0, 8).map((d) => ({ label: d.title, value: d.state === "LAPSED" ? `lapsed ${Math.abs(d.daysUntil)} days ago` : `expires in ${d.daysUntil} days` })),
    summary: tender.documents.length === 0 ? "No compliance calendar yet — this is the first thing Legal needs." : stale.length ? `${stale.length} of ${tender.documents.length} documents lapsed or expiring.` : `All ${tender.documents.length} documents current.`,
  });

  sections.push({
    key: "contracts",
    title: "Contracts renewing in the next 90 days",
    cents: contracts.reduce((s, c) => s + (c.amountCents ?? 0), 0),
    lines: contracts.map((c) => ({ label: c.title, value: `renews ${c.dueAt.toISOString().slice(0, 10)}${c.noticeDays ? `, notice by ${new Date(c.dueAt.getTime() - c.noticeDays * DAY).toISOString().slice(0, 10)}` : ""}` })),
    summary: contracts.length ? `${contracts.length} renewing — each is a chance to renegotiate or leave.` : "None on record.",
  });

  const retentionCents = retention?.totalHeldCents ?? 0;
  const overdueCents = overdue._sum.amountCents ?? 0;
  sections.push({
    key: "held",
    title: "Your money in other people's hands",
    cents: retentionCents + overdueCents,
    lines: [
      ...(overdueCents ? [{ label: `${overdue._count} invoice${overdue._count === 1 ? "" : "s"} past due`, value: money(overdueCents) }] : []),
      ...(retentionCents ? [{ label: "Retention held by customers", value: money(retentionCents) }] : []),
    ],
    summary: overdueCents + retentionCents ? `${money(overdueCents + retentionCents)} is owed to you and not in the bank.` : "Nothing overdue or held.",
  });

  const totalCents = sections.reduce((s, x) => s + x.cents, 0);
  const headline = totalCents > 0
    ? `The first read found ${money(totalCents)} across leakage, unprofitable work, and money owed to you.`
    : "The first read found nothing costing money yet — mostly because there is little recorded. Each section says what it needs.";

  await prisma.tenant.update({ where: { id: tenantId }, data: { firstAuditAt: now } });
  return { generatedAt: now, sections, totalCents, headline };
}

// ------------------------------------------------------------------ 193

const MILESTONES = [30, 60, 90];

/**
 * Called by the tick. On the day a workspace turns 30, 60 or 90 days old,
 * says what the officers were worth — once per milestone.
 */
export async function ninetyDayCheckIn(tenantId: string, now = new Date()): Promise<number | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true, currency: true } });
  if (!t) return null;
  const age = Math.floor((now.getTime() - t.createdAt.getTime()) / DAY);
  const milestone = MILESTONES.find((m) => age >= m && age < m + 7);
  if (!milestone) return null;
  const already = await prisma.notification.findFirst({ where: { tenantId, title: { startsWith: `Day ${milestone}` } }, select: { id: true } });
  if (already) return null;

  const v = await valueSummary(tenantId, { months: 3, now });
  const money = (c: number) => formatMoney(c, t.currency);
  const body =
    `In ${milestone} days the officers put ${money(v.totals.identifiedCents)} in front of you. ` +
    `You took on ${money(v.totals.acceptedCents)}; ${money(v.totals.realisedCents)} of it is verified in your own data. ` +
    (v.feeSet ? `Against ${money(v.totals.costCents)} in fees, that is ${money(v.netVerifiedCents)} net.` : "Set the monthly fee on the Value page to see the net figure.");
  await createNotification({ tenantId, type: "GENERAL", title: `Day ${milestone}: what your officers were worth`, body, linkHref: `/dashboard/${tenantId}/value` });
  return milestone;
}
