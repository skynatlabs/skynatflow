// Thirteen weeks of cash, built from what the business has actually committed
// to rather than from a growth assumption.
//
// Thirteen because it is a quarter, and a quarter is the horizon on which an
// owner can still do something about a hole: hurry an invoice, delay an
// order, call the bank. A twelve-month projection is a story; a thirteen-week
// one is a decision.
//
// Every line is traceable to a row. Nothing here is modelled, smoothed or
// extrapolated except where it is labelled as such — a forecast an owner
// cannot interrogate is one they will stop believing the first time it is
// wrong, and then it is worse than nothing.

import { prisma } from "@/lib/db";
import { TransactionStatus, TransactionType } from "@prisma/client";

export interface ForecastLine {
  label: string;
  amountCents: number;
  /** Why this number is here, in one phrase. */
  basis: string;
  confidence: "committed" | "likely" | "estimated";
}

export interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  /** Index from now: 0 is the current week. */
  index: number;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  /** Running balance at the end of this week. */
  closingCents: number;
  inflows: ForecastLine[];
  outflows: ForecastLine[];
}

export interface CashForecast {
  openingCents: number;
  weeks: ForecastWeek[];
  /** The first week the balance goes negative, if any. */
  shortfallWeek: number | null;
  lowestCents: number;
  lowestWeek: number;
  totalInflowCents: number;
  totalOutflowCents: number;
  /** Things the forecast could not see, said out loud. */
  caveats: string[];
}

const WEEKS = 13;
const WEEK_MS = 7 * 86_400_000;

/**
 * A calendar date in local terms.
 *
 * toISOString() converts to UTC first, so in any timezone east of UTC the
 * Monday a week starts on is emitted as the Sunday before it. For a business
 * in Johannesburg every week in the forecast would be labelled a day early.
 */
function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Monday-based: a business week, not a calendar one.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * How likely an invoice is to land in the week it is due.
 *
 * Derived from this customer's own history rather than a blanket assumption:
 * a customer who has always paid on time is a different forecast line from
 * one who has never paid inside 60 days, and treating them the same is what
 * makes most cash forecasts useless.
 */
function weightFor(daysLate: number | null): { weight: number; confidence: ForecastLine["confidence"] } {
  if (daysLate === null) return { weight: 0.85, confidence: "likely" };
  if (daysLate <= 3) return { weight: 0.95, confidence: "likely" };
  if (daysLate <= 14) return { weight: 0.8, confidence: "likely" };
  if (daysLate <= 45) return { weight: 0.6, confidence: "estimated" };
  return { weight: 0.35, confidence: "estimated" };
}

export async function buildCashForecast(params: {
  tenantId: string;
  /** Cash on hand today. The one number we cannot derive without a bank feed. */
  openingCents?: number;
  now?: Date;
}): Promise<CashForecast> {
  const { tenantId, openingCents = 0, now = new Date() } = params;

  const first = startOfWeek(now);
  const horizonEnd = new Date(first.getTime() + WEEKS * WEEK_MS);

  const weeks: ForecastWeek[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(first.getTime() + i * WEEK_MS);
    const end = new Date(start.getTime() + WEEK_MS - 1);
    return {
      weekStart: localDate(start),
      weekEnd: localDate(end),
      index: i,
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
      closingCents: 0,
      inflows: [],
      outflows: [],
    };
  });

  const bucket = (when: Date): ForecastWeek | null => {
    const i = Math.floor((when.getTime() - first.getTime()) / WEEK_MS);
    // Anything already overdue lands in the current week: it is money the
    // business is owed now, not money it was owed in the past.
    if (i < 0) return weeks[0];
    return i < WEEKS ? weeks[i] : null;
  };

  const caveats: string[] = [];

  // ---------------------------------------------------------------- inflows
  const receivables = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.INVOICE,
      status: { in: [TransactionStatus.SENT, TransactionStatus.PARTIALLY_PAID, TransactionStatus.OVERDUE] },
    },
    select: {
      id: true, amountCents: true, dueAt: true, createdAt: true,
      party: { select: { id: true, name: true } },
      children: { where: { type: TransactionType.PAYMENT }, select: { amountCents: true } },
    },
  });

  // One pass over history so each customer's habit is known, rather than a
  // query per invoice.
  const settled = await prisma.transaction.findMany({
    where: { tenantId, type: TransactionType.INVOICE, status: TransactionStatus.PAID, respondedAt: { not: null } },
    select: { partyId: true, dueAt: true, respondedAt: true },
    take: 500,
  });

  const lateness = new Map<string, number[]>();
  for (const row of settled) {
    if (!row.dueAt || !row.respondedAt) continue;
    const days = Math.round((row.respondedAt.getTime() - row.dueAt.getTime()) / 86_400_000);
    const list = lateness.get(row.partyId) ?? [];
    list.push(Math.max(0, days));
    lateness.set(row.partyId, list);
  }

  const typicalLateness = (partyId: string): number | null => {
    const list = lateness.get(partyId);
    if (!list?.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]; // median, not mean — one
    // disastrous payer shouldn't drag a whole customer's profile.
  };

  for (const invoice of receivables) {
    const paid = invoice.children.reduce((sum, c) => sum + c.amountCents, 0);
    const owing = invoice.amountCents - paid;
    if (owing <= 0) continue;

    const habit = typicalLateness(invoice.party.id);
    const { weight, confidence } = weightFor(habit);
    const due = invoice.dueAt ?? invoice.createdAt;
    const expected = habit ? new Date(due.getTime() + habit * 86_400_000) : due;

    const week = bucket(expected);
    if (!week) continue;

    const amount = Math.round(owing * weight);
    week.inflows.push({
      label: invoice.party.name,
      amountCents: amount,
      basis:
        habit === null
          ? "invoice due, no payment history yet"
          : `invoice due, this customer usually pays ${habit} day${habit === 1 ? "" : "s"} late`,
      confidence,
    });
  }

  const recurring = await prisma.recurringInvoice.findMany({
    where: { tenantId, isActive: true, nextRunAt: { lte: horizonEnd } },
    select: {
      id: true, nextRunAt: true, frequency: true, dueInDays: true, lines: true,
      party: { select: { name: true } },
    },
  });

  const stepDays: Record<string, number> = { WEEKLY: 7, FORTNIGHTLY: 14, MONTHLY: 30, QUARTERLY: 91, ANNUALLY: 365 };

  for (const plan of recurring) {
    const lines = Array.isArray(plan.lines) ? (plan.lines as { quantity?: number; unitPriceCents?: number }[]) : [];
    const value = lines.reduce((sum, l) => sum + (l.quantity ?? 1) * (l.unitPriceCents ?? 0), 0);
    if (value <= 0) continue;

    const step = stepDays[plan.frequency] ?? 30;
    let issue = new Date(plan.nextRunAt);

    // Walk the schedule forward across the horizon, not just the next one:
    // a weekly retainer is thirteen lines, and showing one of them would
    // understate the business by an order of magnitude.
    while (issue <= horizonEnd) {
      const expected = new Date(issue.getTime() + plan.dueInDays * 86_400_000);
      const week = bucket(expected);
      if (week) {
        week.inflows.push({
          label: `${plan.party.name} — recurring`,
          amountCents: Math.round(value * 0.9),
          basis: `${plan.frequency.toLowerCase()} invoice, due ${plan.dueInDays} days after issue`,
          confidence: "likely",
        });
      }
      issue = new Date(issue.getTime() + step * 86_400_000);
    }
  }

  // --------------------------------------------------------------- outflows
  const bills = await prisma.purchaseOrder.findMany({
    where: { tenantId, status: "SENT" },
    select: {
      id: true,
      totalCostCents: true,
      sentAt: true,
      createdAt: true,
      supplier: { select: { name: true } },
    },
  });

  for (const bill of bills) {
    if (!bill.totalCostCents) continue;
    // No agreed payment date on a PO yet, so it is assumed due on standard
    // 30-day terms from when it went out. Labelled "likely" rather than
    // "committed" for exactly that reason.
    const issued = bill.sentAt ?? bill.createdAt;
    const week = bucket(new Date(issued.getTime() + 30 * 86_400_000));
    if (!week) continue;
    week.outflows.push({
      label: bill.supplier.name,
      amountCents: bill.totalCostCents,
      basis: "purchase order sent, assumed 30-day terms",
      confidence: "likely",
    });
  }

  // Running costs, from what the business actually spent. Three months of
  // approved expenses, averaged to a week — labelled estimated, because it is.
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const recentExpenses = await prisma.expense.findMany({
    where: { tenantId, status: "APPROVED", createdAt: { gte: since } },
    select: { amountCents: true },
  });

  if (recentExpenses.length > 0) {
    const total = recentExpenses.reduce((sum, e) => sum + e.amountCents, 0);
    const weekly = Math.round(total / 13);
    if (weekly > 0) {
      for (const week of weeks) {
        week.outflows.push({
          label: "Running costs",
          amountCents: weekly,
          basis: "average of the last 13 weeks of approved expenses",
          confidence: "estimated",
        });
      }
    }
  } else {
    caveats.push(
      "No approved expenses in the last quarter, so running costs aren't in this forecast — it will look healthier than the business is."
    );
  }

  if (openingCents === 0) {
    caveats.push(
      "Opening balance is zero because no bank account is connected. The shape is right; the level is relative."
    );
  }
  if (receivables.length === 0 && recurring.length === 0) {
    caveats.push("Nothing is currently owed to the business, so there is no income to forecast.");
  }

  // ----------------------------------------------------------------- totals
  let running = openingCents;
  let lowestCents = openingCents;
  let lowestWeek = 0;
  let shortfallWeek: number | null = null;

  for (const week of weeks) {
    week.inflowCents = week.inflows.reduce((s, l) => s + l.amountCents, 0);
    week.outflowCents = week.outflows.reduce((s, l) => s + l.amountCents, 0);
    week.netCents = week.inflowCents - week.outflowCents;
    running += week.netCents;
    week.closingCents = running;

    if (running < lowestCents) {
      lowestCents = running;
      lowestWeek = week.index;
    }
    if (running < 0 && shortfallWeek === null) shortfallWeek = week.index;
  }

  return {
    openingCents,
    weeks,
    shortfallWeek,
    lowestCents,
    lowestWeek,
    totalInflowCents: weeks.reduce((s, w) => s + w.inflowCents, 0),
    totalOutflowCents: weeks.reduce((s, w) => s + w.outflowCents, 0),
    caveats,
  };
}
