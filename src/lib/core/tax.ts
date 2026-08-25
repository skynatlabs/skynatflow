// Tax/VAT-ready reporting — not a filing integration (no SARS/IRS API
// call), just a structured breakdown of what was actually charged, ready
// to hand to an accountant or drop straight into a VAT201/sales-tax
// return. Every invoice line already carries the tax rate that applied at
// the time, so this is a pure aggregation over existing ledger data.

import { prisma } from "@/lib/db";

export interface TaxPeriodRow {
  periodLabel: string; // e.g. "2026-01" or a 2-month SARS-style period
  taxRatePercent: number;
  taxableSalesCents: number;
  taxCollectedCents: number;
}

function monthLabel(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// SARS VAT201 periods are bi-monthly (Jan/Feb, Mar/Apr, ...) for most
// small vendors — group by that instead of calendar month when asked.
function sarsPeriodLabel(date: Date) {
  const year = date.getUTCFullYear();
  const pairStart = Math.floor(date.getUTCMonth() / 2) * 2; // 0,2,4,...
  const start = new Date(Date.UTC(year, pairStart, 1)).toLocaleString("en", { month: "short" });
  const end = new Date(Date.UTC(year, pairStart + 1, 1)).toLocaleString("en", { month: "short" });
  return `${year} ${start}-${end}`;
}

export async function getTaxSummary(
  tenantId: string,
  opts: { from?: Date; to?: Date; grouping?: "monthly" | "sars-bimonthly" } = {}
): Promise<TaxPeriodRow[]> {
  const grouping = opts.grouping ?? "monthly";

  const lines = await prisma.transactionLine.findMany({
    where: {
      item: { tenantId },
      transaction: {
        type: "INVOICE",
        status: "PAID",
        ...(opts.from || opts.to
          ? { createdAt: { gte: opts.from, lte: opts.to } }
          : {}),
      },
    },
    include: { item: true, transaction: true },
  });

  const byKey = new Map<string, TaxPeriodRow>();

  for (const line of lines) {
    const rate = line.item.taxRatePercent ?? 0;
    const lineSubtotal = line.unitPriceCents * line.quantity;
    // unitPriceCents is tax-exclusive at line level (Item.unitPriceCents),
    // so tax charged = subtotal * rate.
    const taxCents = Math.round((lineSubtotal * rate) / 100);
    const date = line.transaction.createdAt;
    const periodLabel = grouping === "sars-bimonthly" ? sarsPeriodLabel(date) : monthLabel(date);
    const key = `${periodLabel}|${rate}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.taxableSalesCents += lineSubtotal;
      existing.taxCollectedCents += taxCents;
    } else {
      byKey.set(key, {
        periodLabel,
        taxRatePercent: rate,
        taxableSalesCents: lineSubtotal,
        taxCollectedCents: taxCents,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
}
