// The value ledger.
//
// A product claiming to save money has to show its own arithmetic, and the
// arithmetic has three honest numbers, not one. What the officers found and
// put in front of somebody (identified). What the owner said yes to
// (accepted). What can later be verified in the business's own data
// (realised). The gap between them is the truth about the product, and a
// ledger that reported only the first would be a sales deck.
//
// Against those sits what the platform cost. Every line is append-only and
// dated; a wrong line is answered by another line, never edited, in the same
// spirit as the general ledger this sits beside.
//
// Realisation is deliberately narrow. Only a finding whose outcome leaves a
// trace in the data gets a REALISED line — a duplicate that was removed, a
// subscription that stopped, a supplier whose price came down. Everything
// else stays "accepted, not yet verified", which is what it is.

import { Officer, ValueKind, ObservationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPENT } from "./expenses";

export async function recordValue(params: {
  tenantId: string;
  officer: Officer;
  kind: ValueKind;
  cents: number;
  observationId?: string | null;
  method?: string | null;
  note?: string | null;
  at?: Date;
}) {
  if (!Number.isFinite(params.cents) || params.cents <= 0) return null;
  return prisma.valueEntry.create({
    data: {
      tenantId: params.tenantId,
      officer: params.officer,
      kind: params.kind,
      cents: Math.round(params.cents),
      observationId: params.observationId ?? null,
      method: params.method ?? null,
      note: params.note ?? null,
      at: params.at ?? new Date(),
    },
  });
}

/**
 * An observation reached a person. Written once per observation, whatever
 * happens to it afterwards; a superseding row is the same finding and does
 * not count again.
 */
export async function recordIdentified(observationIds: string[], at = new Date()) {
  if (observationIds.length === 0) return 0;
  const rows = await prisma.observation.findMany({
    where: { id: { in: observationIds }, moneyCents: { gt: 0 } },
    select: { id: true, tenantId: true, officer: true, handedTo: true, moneyCents: true, dedupeKey: true, supersedesId: true },
  });
  let written = 0;
  for (const o of rows) {
    // The same finding under the same key already counted? Then not again.
    const already = await prisma.valueEntry.findFirst({
      where: {
        tenantId: o.tenantId,
        kind: ValueKind.IDENTIFIED,
        OR: [{ observationId: o.id }, { note: `key:${o.dedupeKey}` }],
      },
      select: { id: true },
    });
    if (already) continue;
    await recordValue({
      tenantId: o.tenantId,
      officer: o.handedTo ?? o.officer,
      kind: ValueKind.IDENTIFIED,
      cents: o.moneyCents ?? 0,
      observationId: o.id,
      note: `key:${o.dedupeKey}`,
      at,
    });
    written++;
  }
  return written;
}

/** The owner said yes. */
export async function recordAccepted(observationId: string, at = new Date()) {
  const o = await prisma.observation.findUnique({
    where: { id: observationId },
    select: { id: true, tenantId: true, officer: true, handedTo: true, moneyCents: true, dedupeKey: true },
  });
  if (!o || !o.moneyCents || o.moneyCents <= 0) return null;
  const already = await prisma.valueEntry.findFirst({
    where: { tenantId: o.tenantId, observationId: o.id, kind: ValueKind.ACCEPTED },
    select: { id: true },
  });
  if (already) return null;
  return recordValue({
    tenantId: o.tenantId,
    officer: o.handedTo ?? o.officer,
    kind: ValueKind.ACCEPTED,
    cents: o.moneyCents,
    observationId: o.id,
    note: `key:${o.dedupeKey}`,
    at,
  });
}

/**
 * What the platform charged this month. Once per month per workspace, from
 * the fee on the tenant; nothing is written when no fee is set, and the
 * summary says so rather than showing savings with no cost beside them.
 */
export async function recordPlatformCost(tenantId: string, now = new Date()) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { monthlyFeeCents: true } });
  if (!t?.monthlyFeeCents || t.monthlyFeeCents <= 0) return null;
  const month = now.toISOString().slice(0, 7);
  const already = await prisma.valueEntry.findFirst({
    where: { tenantId, kind: ValueKind.COST, note: `fee:${month}` },
    select: { id: true },
  });
  if (already) return null;
  return recordValue({
    tenantId,
    officer: Officer.SYSTEM,
    kind: ValueKind.COST,
    cents: t.monthlyFeeCents,
    note: `fee:${month}`,
    method: "Platform fee",
    at: now,
  });
}

// ------------------------------------------------------------- realisation

type Evidence = Array<{ label: string; value: string }>;

function evidenceValue(evidence: unknown, label: string): string | null {
  if (!Array.isArray(evidence)) return null;
  const hit = (evidence as Evidence).find((e) => e && e.label === label);
  return hit ? String(hit.value) : null;
}

interface Accepted {
  id: string;
  tenantId: string;
  officer: Officer;
  handedTo: Officer | null;
  dedupeKey: string;
  subjectId: string | null;
  moneyCents: number | null;
  decidedAt: Date | null;
  evidence: unknown;
}

/**
 * The rules, one per kind of finding whose outcome is visible in the data.
 * Each returns cents realised and how it knows, or null for "not yet".
 */
const RULES: Array<{
  prefix: string;
  waitDays: number;
  check: (o: Accepted, now: Date) => Promise<{ cents: number; method: string } | null>;
}> = [
  {
    // A second copy of a cost, confirmed as one: the money was never spent twice.
    prefix: "cfo:duplicate:",
    waitDays: 0,
    check: async (o) => {
      if (!o.subjectId) return null;
      const e = await prisma.expense.findUnique({
        where: { id: o.subjectId },
        select: { status: true, amountCents: true },
      });
      if (e?.status !== "DUPLICATE") return null;
      return { cents: e.amountCents, method: "The second copy was marked as a duplicate and left out of the books." };
    },
  },
  {
    // A recurring payment the owner agreed to cancel: it stops appearing.
    prefix: "cons:subscription:",
    waitDays: 45,
    check: async (o, now) => {
      const key = evidenceValue(o.evidence, "Match key");
      const annual = Number(evidenceValue(o.evidence, "Annual cents") ?? "0");
      if (!key || !o.decidedAt || annual <= 0) return null;
      const since = o.decidedAt;
      const stillPaying = await prisma.expense.count({
        where: { tenantId: o.tenantId, status: SPENT, spentOn: { gte: since, lte: now }, fingerprint: { not: null }, supplierName: { contains: key, mode: "insensitive" } },
      });
      if (stillPaying > 0) return null;
      return { cents: annual, method: `No payment to ${key} has appeared since it was cancelled.` };
    },
  },
  {
    // A supplier consolidation: later purchases of the same goods come at or
    // below the best price that was on the table.
    prefix: "cons:supplier:",
    waitDays: 30,
    check: async (o, now) => {
      const key = evidenceValue(o.evidence, "Match key");
      const itemId = evidenceValue(o.evidence, "Item id");
      const bestUnit = Number(evidenceValue(o.evidence, "Best unit cents") ?? "0");
      const oldUnit = Number(evidenceValue(o.evidence, "Average unit cents") ?? "0");
      if ((!key && !itemId) || !o.decidedAt || bestUnit <= 0 || oldUnit <= bestUnit) return null;
      const lines = await prisma.expenseLine.findMany({
        where: {
          expense: { tenantId: o.tenantId, status: SPENT, spentOn: { gte: o.decidedAt, lte: now } },
          ...(itemId ? { itemId } : { description: { contains: key!, mode: "insensitive" } }),
        },
        select: { quantity: true, unitCents: true },
      });
      const qty = lines.reduce((s, l) => s + l.quantity, 0);
      if (qty <= 0) return null;
      const paid = lines.reduce((s, l) => s + l.quantity * l.unitCents, 0);
      const wouldHavePaid = qty * oldUnit;
      if (paid >= wouldHavePaid) return null;
      return {
        cents: Math.round(wouldHavePaid - paid),
        method: `${qty} bought since at an average below the old price.`,
      };
    },
  },
];

/**
 * Walk accepted findings and write a REALISED line for any whose outcome the
 * data can now confirm. Idempotent: a finding realises once.
 */
export async function realiseValue(tenantId: string, now = new Date()): Promise<number> {
  const accepted = await prisma.observation.findMany({
    where: { tenantId, status: ObservationStatus.ACTIONED, moneyCents: { gt: 0 } },
    select: {
      id: true, tenantId: true, officer: true, handedTo: true, dedupeKey: true,
      subjectId: true, moneyCents: true, decidedAt: true, evidence: true,
    },
    take: 200,
  });
  if (accepted.length === 0) return 0;

  const done = new Set(
    (
      await prisma.valueEntry.findMany({
        where: { tenantId, kind: ValueKind.REALISED, observationId: { in: accepted.map((a) => a.id) } },
        select: { observationId: true },
      })
    ).map((v) => v.observationId)
  );

  let realised = 0;
  for (const o of accepted) {
    if (done.has(o.id)) continue;
    const rule = RULES.find((r) => o.dedupeKey.startsWith(r.prefix));
    if (!rule) continue;
    if (o.decidedAt && now.getTime() - o.decidedAt.getTime() < rule.waitDays * 86_400_000) continue;
    try {
      const hit = await rule.check(o, now);
      if (!hit) continue;
      await recordValue({
        tenantId,
        officer: o.handedTo ?? o.officer,
        kind: ValueKind.REALISED,
        cents: Math.min(hit.cents, (o.moneyCents ?? hit.cents) * 2),
        observationId: o.id,
        method: hit.method,
        note: `key:${o.dedupeKey}`,
        at: now,
      });
      realised++;
    } catch (err) {
      console.error(`[value] realisation failed for ${o.dedupeKey}:`, err instanceof Error ? err.message : err);
    }
  }
  return realised;
}

// ----------------------------------------------------------------- reading

export interface ValueMonth {
  month: string;
  identifiedCents: number;
  acceptedCents: number;
  realisedCents: number;
  costCents: number;
}

export interface ValueSummary {
  months: ValueMonth[];
  byOfficer: Array<{ officer: Officer; identifiedCents: number; acceptedCents: number; realisedCents: number }>;
  totals: Omit<ValueMonth, "month">;
  /** Realised minus cost. The number an owner can defend to their accountant. */
  netVerifiedCents: number;
  feeSet: boolean;
  /** The fraction of accepted value that has been verified. */
  verifiedPercent: number | null;
  recent: Array<{ at: Date; officer: Officer; kind: ValueKind; cents: number; method: string | null; headline: string | null }>;
}

export async function valueSummary(tenantId: string, opts: { months?: number; now?: Date } = {}): Promise<ValueSummary> {
  const now = opts.now ?? new Date();
  const monthsBack = opts.months ?? 3;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - 1), 1));

  const [entries, tenant] = await Promise.all([
    prisma.valueEntry.findMany({ where: { tenantId, at: { gte: from } }, orderBy: { at: "desc" } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { monthlyFeeCents: true } }),
  ]);

  const months = new Map<string, ValueMonth>();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    months.set(key, { month: key, identifiedCents: 0, acceptedCents: 0, realisedCents: 0, costCents: 0 });
  }
  const byOfficer = new Map<Officer, { identifiedCents: number; acceptedCents: number; realisedCents: number }>();
  const totals = { identifiedCents: 0, acceptedCents: 0, realisedCents: 0, costCents: 0 };

  for (const e of entries) {
    const m = months.get(e.at.toISOString().slice(0, 7));
    const field =
      e.kind === "IDENTIFIED" ? "identifiedCents" : e.kind === "ACCEPTED" ? "acceptedCents" : e.kind === "REALISED" ? "realisedCents" : "costCents";
    if (m) m[field] += e.cents;
    totals[field] += e.cents;
    if (e.kind !== "COST") {
      const o = byOfficer.get(e.officer) ?? { identifiedCents: 0, acceptedCents: 0, realisedCents: 0 };
      o[field as "identifiedCents" | "acceptedCents" | "realisedCents"] += e.cents;
      byOfficer.set(e.officer, o);
    }
  }

  const headlines = new Map(
    (
      await prisma.observation.findMany({
        where: { id: { in: entries.slice(0, 30).map((e) => e.observationId!).filter(Boolean) } },
        select: { id: true, headline: true },
      })
    ).map((o) => [o.id, o.headline])
  );

  return {
    months: [...months.values()],
    byOfficer: [...byOfficer.entries()]
      .map(([officer, v]) => ({ officer, ...v }))
      .sort((a, b) => b.realisedCents - a.realisedCents || b.acceptedCents - a.acceptedCents),
    totals,
    netVerifiedCents: totals.realisedCents - totals.costCents,
    feeSet: Boolean(tenant?.monthlyFeeCents),
    verifiedPercent: totals.acceptedCents > 0 ? Math.round((totals.realisedCents / totals.acceptedCents) * 100) : null,
    recent: entries.slice(0, 30).map((e) => ({
      at: e.at,
      officer: e.officer,
      kind: e.kind,
      cents: e.cents,
      method: e.method,
      headline: e.observationId ? (headlines.get(e.observationId) ?? null) : null,
    })),
  };
}
