// Money in another currency.
//
// Three separate things that get conflated, and conflating them is how a set
// of books ends up unable to explain itself:
//
//   THE RATE ON THE DAY. Frozen onto the document at issue. It never changes
//   again, because the invoice was for that many rands on that day whatever
//   happens afterwards.
//
//   THE CUSTOMER'S CURRENCY. A property of the customer, not of each
//   document, so somebody who pays in dollars is quoted in dollars without
//   anybody remembering to switch it every time.
//
//   THE GAIN OR LOSS ON SETTLEMENT. The difference between the rate when the
//   invoice went out and the rate when the money arrived. Real money, earned
//   or lost by nothing but time, and invisible unless something works it out.
//
// Rates are cached per day because a rate for a past day is a fact that will
// not change, so it is fetched once and written once.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

/** Midnight UTC on the day of a date — the key a daily rate is stored under. */
function dayOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function setRate(params: { base: string; quote: string; rate: number; onDate?: Date; source?: string }) {
  if (!(params.rate > 0)) throw new Error("A rate has to be a positive number.");
  const base = params.base.toUpperCase();
  const quote = params.quote.toUpperCase();
  if (base === quote) throw new Error("A currency does not have a rate against itself.");
  const onDate = dayOf(params.onDate ?? new Date());

  return prisma.fxRate.upsert({
    where: { base_quote_onDate: { base, quote, onDate } },
    create: { base, quote, rate: params.rate, onDate, source: params.source ?? "manual" },
    update: { rate: params.rate, source: params.source ?? "manual" },
  });
}

/**
 * The rate to use for a document on a day.
 *
 * Falls back to the most recent rate before that day rather than to 1, and
 * returns null when there is nothing at all — because silently treating an
 * unknown rate as parity turns a missing setting into a wrong number on a
 * customer's invoice, which is the worst possible way to find out.
 */
export async function rateOn(base: string, quote: string, on: Date = new Date()): Promise<{ rate: number; onDate: Date; stale: boolean } | null> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return { rate: 1, onDate: dayOf(on), stale: false };

  const exact = await prisma.fxRate.findUnique({ where: { base_quote_onDate: { base: b, quote: q, onDate: dayOf(on) } } });
  if (exact) return { rate: exact.rate, onDate: exact.onDate, stale: false };

  const latest = await prisma.fxRate.findFirst({
    where: { base: b, quote: q, onDate: { lte: dayOf(on) } },
    orderBy: { onDate: "desc" },
  });
  if (latest) return { rate: latest.rate, onDate: latest.onDate, stale: true };

  // The inverse pair, where somebody stored only one direction.
  const inverse = await prisma.fxRate.findFirst({
    where: { base: q, quote: b, onDate: { lte: dayOf(on) } },
    orderBy: { onDate: "desc" },
  });
  if (inverse && inverse.rate > 0) return { rate: 1 / inverse.rate, onDate: inverse.onDate, stale: true };

  return null;
}

/** Every rate held for a pair, newest first. For the settings screen. */
export async function rateHistory(base: string, quote: string, take = 30) {
  return prisma.fxRate.findMany({
    where: { base: base.toUpperCase(), quote: quote.toUpperCase() },
    orderBy: { onDate: "desc" },
    take,
  });
}

export async function setCustomerCurrency(tenantId: string, partyId: string, currency: string | null) {
  const party = await prisma.party.findFirst({ where: { id: partyId, tenantId }, select: { id: true } });
  if (!party) throw new Error("That customer is not in this workspace.");
  const code = currency?.trim().toUpperCase() || null;
  if (code && !/^[A-Z]{3}$/.test(code)) throw new Error("A currency is a three-letter code, like USD.");
  return prisma.party.update({ where: { id: partyId }, data: { currency: code } });
}

/** What a new document for this customer should be denominated in. */
export async function currencyForCustomer(tenantId: string, partyId: string): Promise<string> {
  const [party, tenant] = await Promise.all([
    prisma.party.findFirst({ where: { id: partyId, tenantId }, select: { currency: true } }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  return party?.currency ?? tenant.currency;
}

export interface SettlementDifference {
  transactionId: string;
  number: string | null;
  customer: string;
  currency: string;
  /** What the document was worth in the workspace's own currency at issue. */
  atIssueCents: number;
  /** What the money was worth when it actually arrived. */
  atSettlementCents: number;
  /** Positive is a gain. */
  differenceCents: number;
  issuedOn: Date;
  settledOn: Date;
  issueRate: number;
  settlementRate: number;
}

/**
 * Gain and loss on foreign invoices that have been settled.
 *
 * Only fully settled documents are reported: a part-paid invoice has no
 * single settlement date, and inventing one would put a number on the books
 * that nothing in the world corresponds to.
 */
export async function settlementDifferences(tenantId: string, opts: { from?: Date; to?: Date } = {}): Promise<SettlementDifference[]> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });

  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: "INVOICE",
      status: "PAID",
      currency: { not: null },
      fxRateToBase: { not: null },
      ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
    },
    select: {
      id: true,
      externalRef: true,
      amountCents: true,
      currency: true,
      fxRateToBase: true,
      createdAt: true,
      party: { select: { name: true, companyName: true } },
      children: { where: { type: "PAYMENT" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 500,
  });

  const out: SettlementDifference[] = [];
  for (const inv of invoices) {
    const settledOn = inv.children[0]?.createdAt;
    if (!settledOn || !inv.currency || !inv.fxRateToBase) continue;

    const settlement = await rateOn(inv.currency, tenant.currency, settledOn);
    if (!settlement) continue;

    const atIssue = Math.round(inv.amountCents * inv.fxRateToBase);
    const atSettlement = Math.round(inv.amountCents * settlement.rate);
    if (atIssue === atSettlement) continue;

    out.push({
      transactionId: inv.id,
      number: inv.externalRef,
      customer: inv.party.companyName ?? inv.party.name,
      currency: inv.currency,
      atIssueCents: atIssue,
      atSettlementCents: atSettlement,
      differenceCents: atSettlement - atIssue,
      issuedOn: inv.createdAt,
      settledOn,
      issueRate: inv.fxRateToBase,
      settlementRate: settlement.rate,
    });
  }
  return out.sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents));
}

/** The one-line version, for a report header or the agent. */
export async function fxPosition(tenantId: string, opts: { from?: Date; to?: Date } = {}) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const rows = await settlementDifferences(tenantId, opts);
  const gains = rows.filter((r) => r.differenceCents > 0).reduce((s, r) => s + r.differenceCents, 0);
  const losses = rows.filter((r) => r.differenceCents < 0).reduce((s, r) => s + r.differenceCents, 0);
  const net = gains + losses;

  return {
    currency: tenant.currency,
    documents: rows.length,
    gainsCents: gains,
    lossesCents: losses,
    netCents: net,
    summary:
      rows.length === 0
        ? "Nothing settled in another currency."
        : `${rows.length} foreign ${rows.length === 1 ? "invoice" : "invoices"} settled at a net ${
            net >= 0 ? "gain" : "loss"
          } of ${formatMoney(Math.abs(net), tenant.currency)} against the rate on the day they were issued.`,
    rows,
  };
}
