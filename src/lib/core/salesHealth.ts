// Sales health — quoted against won, and customers going quiet.
//
// The facts the sales consultant reasons from: win rate by period and why
// it moved, quotes a customer is reading and not answering, customers whose
// ordering rhythm has broken, and discounting that is eating margin. All of
// it is arithmetic over quotes and invoices that already exist.

import { prisma } from "@/lib/db";

const DAY = 86_400_000;

export interface WinRate {
  quoted: number;
  won: number;
  lost: number;
  open: number;
  winPercent: number | null;
  quotedCents: number;
  wonCents: number;
}

export async function winRate(tenantId: string, from: Date, to: Date): Promise<WinRate> {
  const quotes = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE", status: { not: "DRAFT" }, createdAt: { gte: from, lte: to } },
    select: { status: true, amountCents: true, children: { where: { type: "INVOICE" }, select: { id: true } } },
  });
  let won = 0, lost = 0, open = 0, quotedCents = 0, wonCents = 0;
  for (const q of quotes) {
    quotedCents += q.amountCents;
    if (q.status === "ACCEPTED" || q.children.length > 0) { won++; wonCents += q.amountCents; }
    else if (q.status === "DECLINED" || q.status === "CANCELLED") lost++;
    else open++;
  }
  const decided = won + lost;
  return { quoted: quotes.length, won, lost, open, winPercent: decided > 0 ? Math.round((won / decided) * 100) : null, quotedCents, wonCents };
}

export interface ColdQuote {
  transactionId: string;
  partyId: string;
  partyName: string;
  amountCents: number;
  openCount: number;
  daysSinceSent: number;
  daysSinceOpened: number | null;
}

/** Sent, opened more than once, unanswered — someone deciding. */
export async function readingNotAnswering(tenantId: string): Promise<ColdQuote[]> {
  const now = Date.now();
  const rows = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE", status: "SENT", respondedAt: null, openCount: { gte: 2 } },
    select: { id: true, partyId: true, amountCents: true, openCount: true, createdAt: true, lastOpenedAt: true, party: { select: { name: true } } },
    orderBy: { amountCents: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    transactionId: r.id,
    partyId: r.partyId,
    partyName: r.party.name,
    amountCents: r.amountCents,
    openCount: r.openCount,
    daysSinceSent: Math.floor((now - r.createdAt.getTime()) / DAY),
    daysSinceOpened: r.lastOpenedAt ? Math.floor((now - r.lastOpenedAt.getTime()) / DAY) : null,
  }));
}

export interface QuietCustomer {
  partyId: string;
  partyName: string;
  orders: number;
  usualGapDays: number;
  daysSinceLast: number;
  lastAt: Date;
  annualCents: number;
}

/**
 * Customers whose ordering rhythm has broken: at least three invoices, and
 * now twice their usual gap since the last. Their annual value is what is
 * at stake if the silence is a goodbye.
 */
export async function quietCustomers(tenantId: string, now = new Date()): Promise<QuietCustomer[]> {
  const invoices = await prisma.transaction.findMany({
    where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: new Date(now.getTime() - 540 * DAY) } },
    select: { partyId: true, amountCents: true, createdAt: true, party: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const by = new Map<string, typeof invoices>();
  for (const i of invoices) by.set(i.partyId, [...(by.get(i.partyId) ?? []), i]);
  const out: QuietCustomer[] = [];
  for (const [partyId, list] of by) {
    if (list.length < 3) continue;
    const gaps = list.slice(1).map((x, i) => (x.createdAt.getTime() - list[i].createdAt.getTime()) / DAY).sort((a, b) => a - b);
    const usual = gaps[Math.floor(gaps.length / 2)];
    if (usual < 3) continue;
    const last = list[list.length - 1].createdAt;
    const since = (now.getTime() - last.getTime()) / DAY;
    if (since < usual * 2 || since < 21) continue;
    const spanDays = Math.max(30, (last.getTime() - list[0].createdAt.getTime()) / DAY);
    const total = list.reduce((s, x) => s + x.amountCents, 0);
    out.push({ partyId, partyName: list[0].party.name, orders: list.length, usualGapDays: Math.round(usual), daysSinceLast: Math.round(since), lastAt: last, annualCents: Math.round((total / spanDays) * 365) });
  }
  return out.sort((a, b) => b.annualCents - a.annualCents);
}

export interface DiscountLeak {
  lines: number;
  discountCents: number;
  documents: number;
  topCustomer: string | null;
}

/** Money given away in line and document discounts on invoices, over a period. */
export async function discountLeak(tenantId: string, from: Date, to: Date): Promise<DiscountLeak> {
  const docs = await prisma.transaction.findMany({
    where: { tenantId, type: "INVOICE", status: { notIn: ["DRAFT", "CANCELLED"] }, createdAt: { gte: from, lte: to } },
    select: { discountPercent: true, party: { select: { name: true } }, itemLines: { select: { quantity: true, unitPriceCents: true, discountPercent: true } } },
  });
  let lines = 0, cents = 0, documents = 0;
  const byCustomer = new Map<string, number>();
  for (const d of docs) {
    let docCents = 0;
    let gross = 0;
    for (const l of d.itemLines) {
      const g = l.quantity * l.unitPriceCents;
      gross += g;
      if ((l.discountPercent ?? 0) > 0) { lines++; docCents += g * ((l.discountPercent ?? 0) / 100); }
    }
    if ((d.discountPercent ?? 0) > 0) docCents += (gross - docCents) * ((d.discountPercent ?? 0) / 100);
    if (docCents > 0) {
      documents++;
      cents += docCents;
      byCustomer.set(d.party.name, (byCustomer.get(d.party.name) ?? 0) + docCents);
    }
  }
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
  return { lines, discountCents: Math.round(cents), documents, topCustomer: top ? top[0] : null };
}
