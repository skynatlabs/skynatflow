// Ask it anything.
//
// The gap this closes: every figure in this app is computed by a function
// somebody wrote in advance, so a question nobody anticipated has no answer
// even when the data is plainly there. "What did we sell to schools last
// March" is an ordinary question and there is no page for it.
//
// The shape that makes this safe is a fixed grammar rather than generated
// SQL. A caller — a person through a form, or the agent through a tool —
// picks a subject, a measure, a grouping and a window from closed sets. The
// query is then assembled here, always scoped to the tenant, and there is no
// path by which a clever input becomes a different query. A model that can
// write SQL against a multi-tenant database is a model one prompt away from
// reading somebody else's books.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export type Subject = "invoices" | "quotes" | "payments" | "costs" | "jobs";
export type Measure = "total" | "count" | "average";
export type GroupBy = "month" | "customer" | "product" | "person" | "category" | "status" | "none";

export interface Window {
  from: Date;
  to: Date;
}

export interface QuerySpec {
  subject: Subject;
  measure: Measure;
  groupBy: GroupBy;
  window: Window;
  /** Narrow to one customer, one product or one person. */
  filter?: { partyId?: string; itemId?: string; membershipId?: string; status?: string };
  limit?: number;
}

export interface QueryRow {
  label: string;
  /** Cents for money measures, a plain count otherwise. */
  value: number;
  /** How many documents or rows are behind this row. */
  n: number;
}

export interface QueryResult {
  spec: QuerySpec;
  rows: QueryRow[];
  total: number;
  /** Cents, or a count. Says which so nothing formats a count as money. */
  unit: "money" | "count";
  currency: string;
  /** What was actually counted, so the number can be argued with. */
  basis: string;
  /** Said when the answer rests on very little. */
  caveat: string | null;
}

export const SUBJECT_LABEL: Record<Subject, string> = {
  invoices: "invoices",
  quotes: "quotes",
  payments: "payments received",
  costs: "costs",
  jobs: "jobs",
};

export const GROUP_LABEL: Record<GroupBy, string> = {
  month: "by month",
  customer: "by customer",
  product: "by product",
  person: "by person",
  category: "by category",
  status: "by status",
  none: "in total",
};

/** Common windows, said the way people say them. */
export function windowNamed(name: string, now = new Date()): Window {
  const day = 86_400_000;
  switch (name) {
    case "this-month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    case "last-month": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return { from, to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59)) };
    }
    case "this-year":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now };
    case "last-year":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31, 23, 59, 59)),
      };
    case "last-90-days":
      return { from: new Date(now.getTime() - 90 * day), to: now };
    case "last-30-days":
    default:
      return { from: new Date(now.getTime() - 30 * day), to: now };
  }
}

function monthKey(d: Date): string {
  return d.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Run one query.
 *
 * Every branch reads from the tenant's own rows and nothing takes a raw
 * string into a query. The `basis` line is not decoration — a figure whose
 * denominator is invisible is one people argue about instead of acting on.
 */
export async function ask(tenantId: string, spec: QuerySpec): Promise<QueryResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const limit = Math.min(50, Math.max(1, spec.limit ?? 12));
  const money = spec.subject !== "jobs" || spec.measure !== "count";

  const rows: QueryRow[] = [];
  let basis = "";

  if (spec.subject === "costs") {
    const costs = await prisma.expense.findMany({
      where: {
        tenantId,
        status: { not: "REJECTED" },
        spentOn: { gte: spec.window.from, lte: spec.window.to },
        ...(spec.filter?.partyId ? { supplierId: spec.filter.partyId } : {}),
      },
      select: { amountCents: true, spentOn: true, category: true, supplierName: true, supplier: { select: { name: true, companyName: true } } },
    });
    basis = `Every cost recorded between ${spec.window.from.toISOString().slice(0, 10)} and ${spec.window.to.toISOString().slice(0, 10)}, excluding anything rejected.`;

    const by = new Map<string, { value: number; n: number }>();
    for (const cost of costs) {
      const key =
        spec.groupBy === "month"
          ? monthKey(cost.spentOn)
          : spec.groupBy === "category"
            ? cost.category ?? "Uncategorised"
            : spec.groupBy === "customer"
              ? cost.supplier?.companyName ?? cost.supplier?.name ?? cost.supplierName ?? "Unknown supplier"
              : "Total";
      const row = by.get(key) ?? { value: 0, n: 0 };
      row.value += cost.amountCents;
      row.n += 1;
      by.set(key, row);
    }
    for (const [label, row] of by) rows.push({ label, value: row.value, n: row.n });
  } else if (spec.subject === "jobs") {
    const jobs = await prisma.jobCard.findMany({
      where: {
        tenantId,
        createdAt: { gte: spec.window.from, lte: spec.window.to },
        ...(spec.filter?.partyId ? { partyId: spec.filter.partyId } : {}),
        ...(spec.filter?.membershipId ? { assignedToId: spec.filter.membershipId } : {}),
      },
      select: {
        createdAt: true,
        status: true,
        party: { select: { name: true, companyName: true } },
        assignedTo: { select: { user: { select: { name: true, email: true } } } },
      },
    });
    basis = `Every job card raised in the window.`;

    const by = new Map<string, { value: number; n: number }>();
    for (const jobCard of jobs) {
      const key =
        spec.groupBy === "month"
          ? monthKey(jobCard.createdAt)
          : spec.groupBy === "customer"
            ? jobCard.party.companyName ?? jobCard.party.name
            : spec.groupBy === "person"
              ? jobCard.assignedTo?.user.name ?? jobCard.assignedTo?.user.email ?? "Nobody"
              : spec.groupBy === "status"
                ? jobCard.status.toLowerCase()
                : "Total";
      const row = by.get(key) ?? { value: 0, n: 0 };
      row.value += 1;
      row.n += 1;
      by.set(key, row);
    }
    for (const [label, row] of by) rows.push({ label, value: row.value, n: row.n });
  } else if (spec.groupBy === "product") {
    const type = spec.subject === "quotes" ? "QUOTE" : "INVOICE";
    const lines = await prisma.transactionLine.findMany({
      where: {
        item: { tenantId, ...(spec.filter?.itemId ? { id: spec.filter.itemId } : {}) },
        transaction: {
          tenantId,
          type,
          status: { notIn: ["DRAFT", "CANCELLED"] },
          createdAt: { gte: spec.window.from, lte: spec.window.to },
          ...(spec.filter?.partyId ? { partyId: spec.filter.partyId } : {}),
        },
      },
      select: { quantity: true, unitPriceCents: true, discountPercent: true, item: { select: { name: true } } },
    });
    basis = `Lines on ${SUBJECT_LABEL[spec.subject]} in the window, with line discounts taken off. Drafts and cancellations are not counted.`;

    const by = new Map<string, { value: number; n: number }>();
    for (const line of lines) {
      const row = by.get(line.item.name) ?? { value: 0, n: 0 };
      row.value += Math.round(line.quantity * line.unitPriceCents * (1 - (line.discountPercent ?? 0) / 100));
      row.n += 1;
      by.set(line.item.name, row);
    }
    for (const [label, row] of by) rows.push({ label, value: row.value, n: row.n });
  } else {
    const type = spec.subject === "quotes" ? "QUOTE" : spec.subject === "payments" ? "PAYMENT" : "INVOICE";
    const documents = await prisma.transaction.findMany({
      where: {
        tenantId,
        type,
        ...(type === "PAYMENT" ? {} : { status: { notIn: ["DRAFT" as const, "CANCELLED" as const] } }),
        createdAt: { gte: spec.window.from, lte: spec.window.to },
        ...(spec.filter?.partyId ? { partyId: spec.filter.partyId } : {}),
        ...(spec.filter?.status ? { status: spec.filter.status as Prisma.EnumTransactionStatusFilter["equals"] } : {}),
      },
      select: {
        amountCents: true,
        createdAt: true,
        status: true,
        party: { select: { name: true, companyName: true } },
        salesPersonMembership: { select: { user: { select: { name: true, email: true } } } },
      },
    });
    basis =
      type === "PAYMENT"
        ? "Every payment received in the window."
        : `Every ${SUBJECT_LABEL[spec.subject].replace(/s$/, "")} issued in the window. Drafts and cancellations are not counted.`;

    const by = new Map<string, { value: number; n: number }>();
    for (const doc of documents) {
      const key =
        spec.groupBy === "month"
          ? monthKey(doc.createdAt)
          : spec.groupBy === "customer"
            ? doc.party.companyName ?? doc.party.name
            : spec.groupBy === "person"
              ? doc.salesPersonMembership?.user.name ?? doc.salesPersonMembership?.user.email ?? "Nobody named"
              : spec.groupBy === "status"
                ? doc.status.replace(/_/g, " ").toLowerCase()
                : "Total";
      const row = by.get(key) ?? { value: 0, n: 0 };
      row.value += doc.amountCents;
      row.n += 1;
      by.set(key, row);
    }
    for (const [label, row] of by) rows.push({ label, value: row.value, n: row.n });
  }

  // Counts and averages are derived from the same totals rather than queried
  // separately, so the three measures can never disagree with each other.
  const shaped = rows.map((r) => ({
    label: r.label,
    n: r.n,
    value: spec.measure === "count" ? r.n : spec.measure === "average" ? Math.round(r.value / Math.max(1, r.n)) : r.value,
  }));

  // Months read in order; everything else reads biggest first.
  if (spec.groupBy === "month") shaped.sort((a, b) => new Date(`1 ${a.label}`).getTime() - new Date(`1 ${b.label}`).getTime());
  else shaped.sort((a, b) => b.value - a.value);

  const kept = shaped.slice(0, limit);
  // The headline is worked out from the raw sums rather than from the shaped
  // rows: an average of per-group averages is not the average, and taking it
  // from the shaped list gave a mean of means — or, for an average, zero.
  const rawTotal = rows.reduce((s, r) => s + r.value, 0);
  const documents = rows.reduce((s, r) => s + r.n, 0);
  const total =
    spec.measure === "count" ? documents : spec.measure === "average" ? Math.round(rawTotal / Math.max(1, documents)) : rawTotal;

  return {
    spec,
    rows: kept,
    total,
    unit: spec.measure === "count" || spec.subject === "jobs" ? "count" : money ? "money" : "count",
    currency: tenant.currency,
    basis,
    caveat:
      documents === 0
        ? "Nothing at all in that window, so there is no figure to give."
        : documents < 5
          ? `Only ${documents} ${documents === 1 ? "record" : "records"} behind this, so it is a fact about those rather than a pattern.`
          : shaped.length > kept.length
            ? `Showing the top ${kept.length} of ${shaped.length}.`
            : null,
  };
}

/** The answer as a sentence, for the agent and for a voice reply. */
export function asSentence(result: QueryResult): string {
  const value = result.unit === "money" ? formatMoney(result.total, result.currency) : String(result.total);
  const what = `${SUBJECT_LABEL[result.spec.subject]} ${GROUP_LABEL[result.spec.groupBy]}`;
  const window = `${result.spec.window.from.toISOString().slice(0, 10)} to ${result.spec.window.to.toISOString().slice(0, 10)}`;

  if (result.rows.length === 0) return `Nothing recorded for ${what} between ${window}.`;
  const top = result.rows[0];
  const topValue = result.unit === "money" ? formatMoney(top.value, result.currency) : String(top.value);

  return (
    `${value} across ${what}, ${window}.` +
    (result.spec.groupBy === "none" ? "" : ` The largest is ${top.label} at ${topValue}.`) +
    (result.caveat ? ` ${result.caveat}` : "")
  );
}
