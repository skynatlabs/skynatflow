// The consolidation engine — the same saving nobody has time to find.
//
// Five places a business pays more than it needs to, none of which is visible
// from inside a single week:
//
//   the same goods from four suppliers at four prices
//   three runs to one suburb that should have been one
//   two subscriptions doing one job
//   buying weekly at retail what would cost less monthly at trade
//   five insurance policies with three insurers
//
// Every finding comes with a rand figure per year and how much effort it
// would take. A saving needing a fortnight is a different proposition from
// one needing a phone call, and saying which is the difference between a
// report acted on and one admired.
//
// Where a figure rests on an assumption — a trade discount nobody has
// negotiated yet, what a merged run would actually cost — the assumption is
// named in the evidence and the confidence is low. Better a low number a
// person can check than a confident one they cannot.

import { prisma } from "@/lib/db";
import { SPENT } from "./expenses";
import { costRates, tripCostCents, periodDays, type Period } from "./costing";
import { buildCashForecast } from "./cashForecast";
import { normalisePlace } from "./trips";
import { formatMoney, tenantCurrency } from "./currency";

export type Effort = "PHONE_CALL" | "AFTERNOON" | "FORTNIGHT";

export const EFFORT_LABEL: Record<Effort, string> = {
  PHONE_CALL: "A phone call",
  AFTERNOON: "An afternoon",
  FORTNIGHT: "A fortnight",
};

export type SavingKind = "SUPPLIER" | "TRIPS" | "SUBSCRIPTION" | "TIMING" | "INSURANCE";

export interface Saving {
  /** Stable across runs, so the bus supersedes rather than repeats. */
  key: string;
  kind: SavingKind;
  headline: string;
  detail: string;
  annualCents: number;
  effort: Effort;
  /** 0-100. */
  confidence: number;
  evidence: Array<{ label: string; value: string }>;
  proposedAction: string;
  subjectType?: string;
  subjectId?: string;
}

/** Below this a saving is a rounding error and a distraction. */
export const MIN_ANNUAL_CENTS = 500_00;

/** What a trade account typically knocks off retail. Named, not hidden. */
const ASSUMED_TRADE_DISCOUNT = 0.08;
/** What a single fleet book typically saves against scattered policies. */
const ASSUMED_INSURANCE_SAVING = 0.1;
/** Of a run that could have been folded into another, the share still driven. */
const FOLDED_RUN_RESIDUAL = 0.5;

function normaliseName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\(pty\)|\bltd\b|\bcc\b|\binc\b|\bthe\b/g, "")
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseGoods(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9]+([.,][0-9]+)?\s*(l|kg|g|ml|mm|cm|m|pcs|x)?\b/g, " ")
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- suppliers

interface GoodsRow {
  key: string;
  label: string;
  unit: string | null;
  itemId: string | null;
  supplierKey: string;
  supplierName: string;
  qty: number;
  spend: number;
}

/**
 * The same goods from more than one supplier at more than one price.
 *
 * Reads slip lines and purchase-order lines together, matched by catalogue
 * item where there is one and by the words on the line where there is not.
 * The saving is what the volume already bought would have cost at the best
 * price already being paid — nothing has to be negotiated for it to be real.
 */
export async function supplierConsolidation(tenantId: string, period: Period): Promise<Saving[]> {
  const [lines, poLines, currency] = await Promise.all([
    prisma.expenseLine.findMany({
      where: { expense: { tenantId, status: SPENT, spentOn: { gte: period.from, lte: period.to } } },
      select: {
        description: true, quantity: true, unit: true, unitCents: true, itemId: true,
        item: { select: { name: true } },
        expense: { select: { supplierId: true, supplierName: true, supplier: { select: { name: true } } } },
      },
    }),
    prisma.purchaseOrderLine.findMany({
      where: { purchaseOrder: { tenantId, status: { not: "DRAFT" }, createdAt: { gte: period.from, lte: period.to } } },
      select: {
        quantity: true, unitCostCents: true, itemId: true,
        item: { select: { name: true, unit: true } },
        purchaseOrder: { select: { supplierId: true, supplier: { select: { name: true } } } },
      },
    }),
    tenantCurrency(tenantId),
  ]);
  const money = (c: number) => formatMoney(c, currency);

  const rows: GoodsRow[] = [];
  for (const l of lines) {
    const supplierKey = l.expense.supplierId ?? normaliseName(l.expense.supplierName);
    if (!supplierKey || l.quantity <= 0 || l.unitCents <= 0) continue;
    const goods = normaliseGoods(l.description);
    if (!l.itemId && !goods) continue;
    rows.push({
      key: l.itemId ? `item:${l.itemId}` : `desc:${goods}${l.unit ? `:${l.unit.toLowerCase()}` : ""}`,
      label: l.item?.name ?? l.description,
      unit: l.unit,
      itemId: l.itemId,
      supplierKey,
      supplierName: l.expense.supplier?.name ?? l.expense.supplierName ?? "a supplier",
      qty: l.quantity,
      spend: l.quantity * l.unitCents,
    });
  }
  for (const l of poLines) {
    if (l.quantity <= 0 || l.unitCostCents <= 0) continue;
    rows.push({
      key: `item:${l.itemId}`,
      label: l.item.name,
      unit: l.item.unit,
      itemId: l.itemId,
      supplierKey: l.purchaseOrder.supplierId,
      supplierName: l.purchaseOrder.supplier.name,
      qty: l.quantity,
      spend: l.quantity * l.unitCostCents,
    });
  }

  const byGoods = new Map<string, GoodsRow[]>();
  for (const r of rows) byGoods.set(r.key, [...(byGoods.get(r.key) ?? []), r]);

  const days = periodDays(period);
  const out: Saving[] = [];
  for (const [key, group] of byGoods) {
    const bySupplier = new Map<string, { name: string; qty: number; spend: number }>();
    for (const r of group) {
      const cur = bySupplier.get(r.supplierKey) ?? { name: r.supplierName, qty: 0, spend: 0 };
      cur.qty += r.qty;
      cur.spend += r.spend;
      bySupplier.set(r.supplierKey, cur);
    }
    if (bySupplier.size < 2) continue;

    const suppliers = [...bySupplier.values()].map((s) => ({ ...s, unit: s.spend / s.qty }));
    const best = suppliers.reduce((a, b) => (a.unit <= b.unit ? a : b));
    const worst = suppliers.reduce((a, b) => (a.unit >= b.unit ? a : b));
    if (worst.unit / best.unit - 1 < 0.05) continue;

    const totalQty = suppliers.reduce((s, x) => s + x.qty, 0);
    const totalSpend = suppliers.reduce((s, x) => s + x.spend, 0);
    const periodSaving = suppliers.reduce((s, x) => s + (x.unit - best.unit) * x.qty, 0);
    const annualCents = Math.round(periodSaving * (365 / days));
    if (annualCents < MIN_ANNUAL_CENTS) continue;

    const first = group[0];
    const unitWord = first.unit ?? "unit";
    const confidence = (first.itemId ? 70 : 55) - (totalQty < 5 ? 15 : 0);

    out.push({
      key: `cons:supplier:${key}`,
      kind: "SUPPLIER",
      headline: `${first.label} is bought from ${suppliers.length} suppliers at ${money(Math.round(best.unit))} to ${money(Math.round(worst.unit))} a ${unitWord}.`,
      detail: `On the ${totalQty.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unitWord}${totalQty === 1 ? "" : "s"} already bought, paying ${best.name}'s price everywhere would have saved ${money(Math.round(periodSaving))}. That is volume the business already has, priced as though it did not.`,
      annualCents,
      effort: "PHONE_CALL",
      confidence,
      evidence: [
        { label: "Match key", value: first.label },
        ...(first.itemId ? [{ label: "Item id", value: first.itemId }] : []),
        { label: "Best supplier", value: `${best.name} at ${money(Math.round(best.unit))}` },
        { label: "Best unit cents", value: String(Math.round(best.unit)) },
        { label: "Average unit cents", value: String(Math.round(totalSpend / totalQty)) },
        { label: "Suppliers", value: suppliers.map((s) => `${s.name} ${money(Math.round(s.unit))}`).join(", ") },
        { label: "Bought", value: `${totalQty.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unitWord} for ${money(Math.round(totalSpend))}` },
      ],
      proposedAction: `Call ${best.name} and ask for their price on the whole volume. The volume is the leverage; nobody has used it yet.`,
      subjectType: first.itemId ? "item" : undefined,
      subjectId: first.itemId ?? undefined,
    });
  }
  return out;
}

// -------------------------------------------------------------------- trips

/**
 * Runs to the same area in the same week that could have been one run.
 *
 * Found across jobs, customers and days — the view no individual dispatcher
 * has. Only raised when it recurs: one busy week is a busy week, the same
 * suburb twice a week for a month is a planning gap.
 */
export async function tripConsolidation(tenantId: string, period: Period): Promise<Saving[]> {
  const [trips, rates, currency] = await Promise.all([
    prisma.trip.findMany({
      where: { tenantId, status: "DONE", startedAt: { gte: period.from, lte: period.to } },
      select: {
        id: true, assetId: true, distanceKm: true, startedAt: true,
        stops: { select: { lat: true, lng: true, addressText: true, party: { select: { name: true, city: true } } } },
      },
    }),
    costRates(tenantId, period),
    tenantCurrency(tenantId),
  ]);
  const money = (c: number) => formatMoney(c, currency);

  const areaOf = (s: (typeof trips)[number]["stops"][number]): { key: string; label: string } | null => {
    if (s.lat !== null && s.lng !== null) {
      return { key: `g:${Math.round(s.lat / 0.045)}:${Math.round(s.lng / 0.045)}`, label: s.party?.city ?? s.party?.name ?? s.addressText ?? "the same area" };
    }
    const city = normalisePlace(s.party?.city);
    if (city) return { key: `c:${city}`, label: s.party?.city ?? city };
    const addr = normalisePlace(s.addressText);
    if (addr) return { key: `a:${addr}`, label: s.addressText ?? addr };
    return null;
  };

  // Each trip belongs to the area most of its stops are in.
  const byWeekArea = new Map<string, { area: string; label: string; week: string; trips: (typeof trips)[number][] }>();
  for (const t of trips) {
    const counts = new Map<string, { n: number; label: string }>();
    for (const s of t.stops) {
      const a = areaOf(s);
      if (!a) continue;
      const cur = counts.get(a.key) ?? { n: 0, label: a.label };
      cur.n += 1;
      counts.set(a.key, cur);
    }
    if (counts.size === 0 || !t.startedAt) continue;
    const [areaKey, area] = [...counts.entries()].sort((x, y) => y[1].n - x[1].n)[0];
    const week = isoWeek(t.startedAt);
    const k = `${week}|${areaKey}`;
    const cur = byWeekArea.get(k) ?? { area: areaKey, label: area.label, week, trips: [] };
    cur.trips.push(t);
    byWeekArea.set(k, cur);
  }

  // Per area: the weeks it was visited more than once.
  const byArea = new Map<string, { label: string; weeks: Array<{ week: string; trips: (typeof trips)[number][] }> }>();
  for (const g of byWeekArea.values()) {
    if (g.trips.length < 2) continue;
    const cur = byArea.get(g.area) ?? { label: g.label, weeks: [] };
    cur.weeks.push({ week: g.week, trips: g.trips });
    byArea.set(g.area, cur);
  }

  const days = periodDays(period);
  const out: Saving[] = [];
  for (const [areaKey, a] of byArea) {
    if (a.weeks.length < 2) continue;
    let periodSaving = 0;
    let foldable = 0;
    let priced = true;
    let totalTrips = 0;
    for (const w of a.weeks) {
      const costs = w.trips.map((t) => tripCostCents(t, rates));
      if (costs.some((c) => !c.priced)) priced = false;
      const sorted = costs.map((c) => c.cents).sort((x, y) => y - x);
      // Keep the biggest run; the rest could have ridden along at a fraction.
      periodSaving += sorted.slice(1).reduce((s, c) => s + c * (1 - FOLDED_RUN_RESIDUAL), 0);
      foldable += w.trips.length - 1;
      totalTrips += w.trips.length;
    }
    const annualCents = Math.round(periodSaving * (365 / days));
    if (annualCents < MIN_ANNUAL_CENTS) continue;

    out.push({
      key: `cons:trips:${areaKey}`,
      kind: "TRIPS",
      headline: `${a.label} was driven to ${totalTrips} times across ${a.weeks.length} weeks when ${a.weeks.length} runs would have done.`,
      detail: `${foldable} of those runs could have been folded into another the same week. Assuming a folded drop still costs about half of a separate run, that is ${money(Math.round(periodSaving))} over the period.`,
      annualCents,
      effort: "AFTERNOON",
      confidence: priced ? 45 : 30,
      evidence: [
        { label: "Weeks", value: a.weeks.map((w) => `${w.week}: ${w.trips.length} runs`).join("; ") },
        { label: "Assumption", value: `a folded drop costs ${Math.round(FOLDED_RUN_RESIDUAL * 100)}% of a separate run` },
        ...(priced ? [] : [{ label: "Caveat", value: "some runs had no distance or no cost rate, so this is understated" }]),
      ],
      proposedAction: `Batch work for ${a.label} into one run a week and hold the rest for it. An afternoon to set the rule; the runs then plan themselves.`,
    });
  }
  return out;
}

// ------------------------------------------------------------- recurring

export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface RecurringItem {
  key: string;
  label: string;
  cadence: Cadence;
  typicalCents: number;
  annualCents: number;
  occurrences: number;
  lastAt: Date;
  source: "expenses" | "bank" | "both";
  accountId: string | null;
  category: string | null;
  /** Who records it, when anybody does. */
  who: string[];
}

const PER_YEAR: Record<Cadence, number> = { WEEKLY: 52, MONTHLY: 12, QUARTERLY: 4, ANNUAL: 1 };

function cadenceOf(gapDays: number): Cadence | null {
  if (gapDays >= 6 && gapDays <= 8) return "WEEKLY";
  if (gapDays >= 25 && gapDays <= 36) return "MONTHLY";
  if (gapDays >= 80 && gapDays <= 100) return "QUARTERLY";
  if (gapDays >= 340 && gapDays <= 390) return "ANNUAL";
  return null;
}

/**
 * Every recurring payment in one list, with what it costs a year.
 *
 * Read from recorded expenses and from unmatched bank lines, so a
 * subscription nobody ever recorded still shows up — the bank has been
 * paying it whether or not the books heard.
 */
export async function recurringSpend(tenantId: string, now = new Date()): Promise<RecurringItem[]> {
  const from = new Date(now.getTime() - 400 * 86_400_000);
  const [expenses, bankLines] = await Promise.all([
    prisma.expense.findMany({
      // Fuel by the litre and anything tagged to a vehicle, trip or job is a
      // running cost that happens to be regular, not a fee. A weekly diesel
      // stop is not a subscription, and calling it one would be the kind of
      // finding that gets the whole report dismissed.
      where: {
        tenantId, status: SPENT, spentOn: { gte: from, lte: now }, isOwnerDrawing: { not: true },
        quantity: null, assetId: null, tripId: null, jobCardId: null,
      },
      select: {
        spentOn: true, amountCents: true, supplierId: true, supplierName: true, descriptionText: true,
        accountId: true, category: true, incurredById: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.bankTransaction.findMany({
      where: { tenantId, status: "UNMATCHED", amountCents: { lt: 0 }, postedOn: { gte: from, lte: now } },
      select: { postedOn: true, amountCents: true, description: true },
    }),
  ]);

  interface Occ { at: Date; cents: number; accountId: string | null; category: string | null; who: string | null; source: "expenses" | "bank" }
  const groups = new Map<string, { label: string; occ: Occ[] }>();
  const add = (key: string, label: string, o: Occ) => {
    if (!key) return;
    const g = groups.get(key) ?? { label, occ: [] };
    g.occ.push(o);
    groups.set(key, g);
  };
  for (const e of expenses) {
    const name = e.supplier?.name ?? e.supplierName ?? e.descriptionText;
    const key = e.supplierId ? `s:${e.supplierId}` : `n:${normaliseName(name)}`;
    add(key, name, { at: e.spentOn, cents: e.amountCents, accountId: e.accountId, category: e.category, who: e.incurredById, source: "expenses" });
  }
  for (const b of bankLines) {
    const norm = normaliseName(b.description);
    add(`n:${norm}`, b.description, { at: b.postedOn, cents: Math.abs(b.amountCents), accountId: null, category: null, who: null, source: "bank" });
  }

  const whoNames = new Map<string, string>();
  const whoIds = [...new Set(expenses.map((e) => e.incurredById).filter((x): x is string => Boolean(x)))];
  if (whoIds.length > 0) {
    const ms = await prisma.membership.findMany({ where: { id: { in: whoIds } }, select: { id: true, user: { select: { name: true, email: true } } } });
    for (const m of ms) whoNames.set(m.id, m.user.name ?? m.user.email);
  }

  const out: RecurringItem[] = [];
  for (const [key, g] of groups) {
    if (g.occ.length < 3) continue;
    const occ = [...g.occ].sort((a, b) => a.at.getTime() - b.at.getTime());
    const gaps = occ.slice(1).map((o, i) => (o.at.getTime() - occ[i].at.getTime()) / 86_400_000);
    const cadence = cadenceOf(median(gaps));
    if (!cadence) continue;
    // Three weekly payments is a fortnight of coincidence; ask for a month.
    if (cadence === "WEEKLY" && occ.length < 4) continue;
    const amounts = occ.map((o) => o.cents);
    const typical = median(amounts);
    if (typical <= 0 || (Math.max(...amounts) - Math.min(...amounts)) / typical > 0.35) continue;
    const sources = new Set(occ.map((o) => o.source));
    out.push({
      key,
      label: g.label,
      cadence,
      typicalCents: Math.round(typical),
      annualCents: Math.round(typical * PER_YEAR[cadence]),
      occurrences: occ.length,
      lastAt: occ[occ.length - 1].at,
      source: sources.size === 2 ? "both" : sources.has("bank") ? "bank" : "expenses",
      accountId: occ.find((o) => o.accountId)?.accountId ?? null,
      category: occ.find((o) => o.category)?.category ?? null,
      who: [...new Set(occ.map((o) => o.who).filter((x): x is string => Boolean(x)))].map((id) => whoNames.get(id) ?? "someone"),
    });
  }
  return out.sort((a, b) => b.annualCents - a.annualCents);
}

/** Two recurring payments that appear to do one job. */
export async function subscriptionOverlaps(tenantId: string, now = new Date()): Promise<Saving[]> {
  const [items, currency] = await Promise.all([recurringSpend(tenantId, now), tenantCurrency(tenantId)]);
  const money = (c: number) => formatMoney(c, currency);
  const out: Saving[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const sameAccount = a.accountId && b.accountId && a.accountId === b.accountId;
      const sameCategory = a.category && b.category && normaliseName(a.category) === normaliseName(b.category);
      if (!sameAccount && !sameCategory) continue;
      const smaller = a.annualCents <= b.annualCents ? a : b;
      const larger = smaller === a ? b : a;
      if (smaller.annualCents < MIN_ANNUAL_CENTS || seen.has(smaller.key)) continue;
      seen.add(smaller.key);
      out.push({
        key: `cons:subscription:${smaller.key}`,
        kind: "SUBSCRIPTION",
        headline: `${a.label} and ${b.label} look like two subscriptions doing one job — ${money(smaller.annualCents)} a year for the smaller.`,
        detail: `Both recur ${smaller.cadence.toLowerCase()} and both are coded to ${sameAccount ? "the same account" : `"${a.category}"`}. If one of them does what the other does, the smaller is ${money(smaller.annualCents)} a year.`,
        annualCents: smaller.annualCents,
        effort: "PHONE_CALL",
        confidence: 40,
        evidence: [
          { label: "Match key", value: smaller.label },
          { label: "Annual cents", value: String(smaller.annualCents) },
          { label: a.label, value: `${money(a.typicalCents)} ${a.cadence.toLowerCase()}, ${a.occurrences} times` },
          { label: b.label, value: `${money(b.typicalCents)} ${b.cadence.toLowerCase()}, ${b.occurrences} times` },
          ...(smaller.who.length > 0 ? [{ label: "Used by", value: smaller.who.join(", ") }] : []),
        ],
        proposedAction: `Ask whoever uses ${smaller.label} whether ${larger.label} covers it. If it does, cancel the smaller one.`,
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------- timing

/**
 * Buying often and small from the same place, where a monthly trade order
 * would cost less — checked against the cash the forecast says is actually
 * there, because a saving that needs cash the business does not have is a
 * loan in disguise.
 */
export async function purchaseTiming(tenantId: string, now = new Date()): Promise<Saving[]> {
  const from = new Date(now.getTime() - 90 * 86_400_000);
  const [expenses, bank, currency] = await Promise.all([
    prisma.expense.findMany({
      where: { tenantId, status: SPENT, spentOn: { gte: from, lte: now }, isOwnerDrawing: { not: true } },
      select: { spentOn: true, amountCents: true, supplierId: true, supplierName: true, supplier: { select: { name: true } } },
    }),
    prisma.bankAccount.findFirst({ where: { tenantId, isActive: true }, select: { lastStatementBalanceCents: true } }),
    tenantCurrency(tenantId),
  ]);
  const money = (c: number) => formatMoney(c, currency);

  const groups = new Map<string, { name: string; amounts: number[] }>();
  for (const e of expenses) {
    const key = e.supplierId ?? normaliseName(e.supplierName);
    if (!key) continue;
    const g = groups.get(key) ?? { name: e.supplier?.name ?? e.supplierName ?? "a supplier", amounts: [] };
    g.amounts.push(e.amountCents);
    groups.set(key, g);
  }

  const candidates = [...groups.entries()].filter(([, g]) => g.amounts.length >= 8);
  if (candidates.length === 0) return [];

  // Cash: the forecast's lowest point over the next month, from the bank's
  // last known balance. No bank feed means no cash check, and the finding
  // says so.
  let lowestCents: number | null = null;
  if (bank?.lastStatementBalanceCents !== null && bank?.lastStatementBalanceCents !== undefined) {
    const f = await buildCashForecast({ tenantId, openingCents: bank.lastStatementBalanceCents, now });
    lowestCents = Math.min(...f.weeks.slice(0, 5).map((w) => w.closingCents));
  }

  const out: Saving[] = [];
  for (const [key, g] of candidates) {
    const total = g.amounts.reduce((s, a) => s + a, 0);
    const monthly = total / 3;
    const annualCents = Math.round(monthly * 12 * ASSUMED_TRADE_DISCOUNT);
    if (annualCents < MIN_ANNUAL_CENTS) continue;
    const cashOk = lowestCents === null ? null : lowestCents >= monthly;
    if (cashOk === false) continue;
    out.push({
      key: `cons:timing:${key}`,
      kind: "TIMING",
      headline: `${g.name} was paid ${g.amounts.length} times in three months — about ${money(Math.round(monthly))} a month in small buys.`,
      detail: `One monthly order on a trade account is usually cheaper than ${Math.round(g.amounts.length / 3)} trips to the counter. At an assumed ${Math.round(ASSUMED_TRADE_DISCOUNT * 100)}% trade discount that is ${money(annualCents)} a year${cashOk ? ", and the forecast says the cash for a monthly order is there" : "; whether the cash is there is unchecked until a bank statement is imported"}.`,
      annualCents,
      effort: "PHONE_CALL",
      confidence: cashOk ? 35 : 25,
      evidence: [
        { label: "Purchases", value: `${g.amounts.length} in 90 days, median ${money(Math.round(median(g.amounts)))}` },
        { label: "Monthly spend", value: money(Math.round(monthly)) },
        { label: "Assumption", value: `${Math.round(ASSUMED_TRADE_DISCOUNT * 100)}% trade discount — set the real figure once negotiated` },
        ...(lowestCents !== null ? [{ label: "Lowest forecast cash, next month", value: money(lowestCents) }] : []),
      ],
      proposedAction: `Ask ${g.name} for a trade account and a monthly price, and buy once a month.`,
    });
  }
  return out;
}

// -------------------------------------------------------------- insurance

const OBLIGATION_PER_YEAR: Record<string, number> = { NONE: 1, MONTHLY: 12, BIMONTHLY: 6, QUARTERLY: 4, BIANNUAL: 2, ANNUAL: 1 };

/** Separate policies on separate things, and what one book usually costs instead. */
export async function insuranceConsolidation(tenantId: string): Promise<Saving[]> {
  const [policies, currency] = await Promise.all([
    prisma.obligation.findMany({
      where: { tenantId, kind: "INSURANCE", status: "OPEN", amountCents: { not: null } },
      select: { id: true, title: true, authority: true, amountCents: true, recurrence: true, asset: { select: { name: true } } },
    }),
    tenantCurrency(tenantId),
  ]);
  if (policies.length < 2) return [];
  const money = (c: number) => formatMoney(c, currency);

  const insurers = new Set(policies.map((p) => normaliseName(p.authority) || "unknown"));
  if (insurers.size < 2 && policies.length < 3) return [];

  const annual = policies.reduce((s, p) => s + (p.amountCents ?? 0) * (OBLIGATION_PER_YEAR[p.recurrence] ?? 1), 0);
  const annualCents = Math.round(annual * ASSUMED_INSURANCE_SAVING);
  if (annualCents < MIN_ANNUAL_CENTS) return [];

  return [
    {
      key: "cons:insurance",
      kind: "INSURANCE",
      headline: `${policies.length} insurance policies with ${insurers.size} insurer${insurers.size === 1 ? "" : "s"} cost ${money(Math.round(annual))} a year. One book usually comes in lower.`,
      detail: `Separate policies on separate vehicles and premises are priced separately. A broker quoting the lot as one schedule typically comes in around ${Math.round(ASSUMED_INSURANCE_SAVING * 100)}% under, which here is ${money(annualCents)} a year — an assumption until a quote says otherwise.`,
      annualCents,
      effort: "PHONE_CALL",
      confidence: 35,
      evidence: [
        ...policies.map((p) => ({
          label: `${p.title}${p.asset ? ` (${p.asset.name})` : ""}`,
          value: `${p.authority ?? "insurer not named"}, ${money(Math.round((p.amountCents ?? 0) * (OBLIGATION_PER_YEAR[p.recurrence] ?? 1)))} a year`,
        })),
        { label: "Annual cents", value: String(Math.round(annual)) },
        { label: "Assumption", value: `${Math.round(ASSUMED_INSURANCE_SAVING * 100)}% saving on one combined schedule` },
      ],
      proposedAction: "Send one broker the full list and ask for a single schedule. A phone call and an email; the quote does the rest.",
    },
  ];
}

// ----------------------------------------------------------------- report

export interface ConsolidationReport {
  period: Period;
  savings: Saving[];
  totalAnnualCents: number;
  /** Each saving weighted by its own confidence — the number to quote. */
  weightedAnnualCents: number;
  recurring: RecurringItem[];
  /** Sources that failed, by name, so a blank section reads as broken rather than clean. */
  failed: string[];
  generatedAt: Date;
}

/**
 * One ranked list of what the engine found, in rands a year, with the effort
 * each would take. A source that throws is reported by name and the rest of
 * the report stands; a partial report that looks complete would be worse
 * than a crash.
 */
export async function consolidationReport(
  tenantId: string,
  opts: { now?: Date; days?: number } = {}
): Promise<ConsolidationReport> {
  const now = opts.now ?? new Date();
  const period: Period = { from: new Date(now.getTime() - (opts.days ?? 90) * 86_400_000), to: now };

  const sources: Array<{ name: string; run: () => Promise<Saving[]> }> = [
    { name: "suppliers", run: () => supplierConsolidation(tenantId, period) },
    { name: "trips", run: () => tripConsolidation(tenantId, period) },
    { name: "subscriptions", run: () => subscriptionOverlaps(tenantId, now) },
    { name: "timing", run: () => purchaseTiming(tenantId, now) },
    { name: "insurance", run: () => insuranceConsolidation(tenantId) },
  ];

  const savings: Saving[] = [];
  const failed: string[] = [];
  for (const s of sources) {
    try {
      savings.push(...(await s.run()));
    } catch (err) {
      failed.push(s.name);
      console.error(`[consolidation] ${s.name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }

  let recurring: RecurringItem[] = [];
  try {
    recurring = await recurringSpend(tenantId, now);
  } catch (err) {
    failed.push("recurring");
    console.error(`[consolidation] recurring failed for ${tenantId}:`, err instanceof Error ? err.message : err);
  }

  savings.sort((a, b) => b.annualCents * b.confidence - a.annualCents * a.confidence);

  return {
    period,
    savings,
    totalAnnualCents: savings.reduce((s, x) => s + x.annualCents, 0),
    weightedAnnualCents: Math.round(savings.reduce((s, x) => s + (x.annualCents * x.confidence) / 100, 0)),
    recurring,
    failed,
    generatedAt: now,
  };
}
