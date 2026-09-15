// The cash flow statement — where the money actually went.
//
// Profit and cash are different numbers, and the gap between them is where
// most owners' intuition breaks. This reads it straight off the journal:
// every movement on the bank and cash accounts, grouped by what the other
// side of the entry was. Operating is trading; investing is equipment and
// vehicles; financing is loans, capital and drawings. The indirect view
// starts from profit and explains the difference.
//
// It reconciles to the forecast's opening balance by construction: both read
// the same bank accounts, so the two can never disagree about today.

import { prisma } from "@/lib/db";
import { profitAndLoss } from "./financialReports";
import { formatMoney, tenantCurrency } from "./currency";

export interface CashFlowLine {
  label: string;
  cents: number;
}

export interface CashFlowStatement {
  from: Date;
  to: Date;
  openingCents: number;
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  operatingCents: number;
  investingCents: number;
  financingCents: number;
  netChangeCents: number;
  closingCents: number;
  /** Indirect: profit, then what turned it into cash. */
  indirect: { netProfitCents: number; adjustments: CashFlowLine[]; operatingCents: number };
  summary: string;
}

function bucketFor(type: string, subtype: string | null): "operating" | "investing" | "financing" {
  if (type === "ASSET" && subtype === "fixed") return "investing";
  if (type === "ASSET" && subtype === "contra") return "investing";
  if (type === "LIABILITY" && subtype === "loan") return "financing";
  if (type === "EQUITY") return "financing";
  return "operating";
}

export async function cashFlowStatement(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<CashFlowStatement> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  const cashAccounts = await prisma.account.findMany({
    where: { tenantId, type: "ASSET", subtype: "cash" },
    select: { id: true },
  });
  const cashIds = new Set(cashAccounts.map((a) => a.id));
  if (cashIds.size === 0) {
    return empty(from, to, await tenantCurrency(tenantId));
  }

  const entries = await prisma.journalEntry.findMany({
    where: { tenantId, lines: { some: { accountId: { in: [...cashIds] } } } },
    select: {
      entryDate: true,
      lines: { select: { accountId: true, debitCents: true, creditCents: true, account: { select: { name: true, type: true, subtype: true } } } },
    },
  });

  let opening = 0;
  const buckets = { operating: new Map<string, number>(), investing: new Map<string, number>(), financing: new Map<string, number>() };

  for (const e of entries) {
    const cashMove = e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    if (e.entryDate < from) {
      opening += cashMove;
      continue;
    }
    if (e.entryDate > to) continue;
    // Attribute the cash movement to the non-cash sides, pro rata.
    const others = e.lines.filter((l) => !cashIds.has(l.accountId));
    const otherTotal = others.reduce((s, l) => s + Math.abs(l.debitCents - l.creditCents), 0) || 1;
    for (const l of others) {
      const share = (Math.abs(l.debitCents - l.creditCents) / otherTotal) * cashMove;
      const b = bucketFor(l.account.type, l.account.subtype);
      buckets[b].set(l.account.name, (buckets[b].get(l.account.name) ?? 0) + share);
    }
  }

  const lines = (m: Map<string, number>) =>
    [...m.entries()].map(([label, c]) => ({ label, cents: Math.round(c) })).filter((l) => l.cents !== 0).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const operating = lines(buckets.operating);
  const investing = lines(buckets.investing);
  const financing = lines(buckets.financing);
  const sum = (ls: CashFlowLine[]) => ls.reduce((s, l) => s + l.cents, 0);
  const operatingCents = sum(operating);
  const investingCents = sum(investing);
  const financingCents = sum(financing);
  const netChangeCents = operatingCents + investingCents + financingCents;

  const pl = await profitAndLoss(tenantId, { from, to });
  const adjustments: CashFlowLine[] = [];
  const gap = operatingCents - pl.netProfitCents;
  if (gap !== 0) adjustments.push({ label: gap > 0 ? "Cash received ahead of profit (deposits, debtors paid, accruals)" : "Profit not yet in cash (debtors unpaid, stock bought, prepayments)", cents: gap });

  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);
  const summary =
    netChangeCents === 0 && operating.length === 0
      ? "No cash moved through the books in this period."
      : `Cash ${netChangeCents >= 0 ? "rose" : "fell"} by ${money(Math.abs(netChangeCents))}: ${money(operatingCents)} from trading, ${money(investingCents)} on equipment, ${money(financingCents)} in loans, capital and drawings. Profit was ${money(pl.netProfitCents)}${gap !== 0 ? `; the ${money(Math.abs(gap))} difference is ${gap > 0 ? "cash that arrived before it was earned" : "profit that has not become cash yet"}.` : "."}`;

  return {
    from, to,
    openingCents: Math.round(opening),
    operating, investing, financing,
    operatingCents, investingCents, financingCents,
    netChangeCents,
    closingCents: Math.round(opening) + netChangeCents,
    indirect: { netProfitCents: pl.netProfitCents, adjustments, operatingCents },
    summary,
  };
}

function empty(from: Date, to: Date, currency: string): CashFlowStatement {
  void currency;
  return {
    from, to, openingCents: 0, operating: [], investing: [], financing: [],
    operatingCents: 0, investingCents: 0, financingCents: 0, netChangeCents: 0, closingCents: 0,
    indirect: { netProfitCents: 0, adjustments: [], operatingCents: 0 },
    summary: "The books are not open yet.",
  };
}
