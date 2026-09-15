// Industry packs — the same six officers, asking what matters in a trade.
//
// A logistics COO watches empty running; a retail one watches stock turn. The
// officers already run every check; what a pack changes is which findings
// rank higher for this kind of business, which accounts its chart starts
// with, and what each officer says it is watching. Nothing is switched off —
// a retailer with a delivery van still hears about the van.

import { NicheSkin } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface IndustryPack {
  label: string;
  /** dedupeKey prefixes this trade should hear about first. */
  emphasis: string[];
  /** Accounts the chart should hold for this trade, beyond the default. */
  accounts: Array<{ code: string; name: string; type: "INCOME" | "EXPENSE" | "ASSET" | "LIABILITY" }>;
  /** What each officer watches, in this trade's words. */
  watches: Partial<Record<"CEO" | "CFO" | "COO" | "LEGAL" | "SALES" | "EFFICIENCY", string>>;
}

export const PACKS: Record<NicheSkin, IndustryPack> = {
  LOGISTICS: {
    label: "Transport & logistics",
    emphasis: ["coo:detention", "coo:empty-running", "coo:recoverables", "coo:fuel:", "coo:service:", "coo:overload:", "coo:subcontractor:", "ceo:lane-loss:", "eff:fleet-share", "cons:trips:"],
    accounts: [
      { code: "5310", name: "Tolls and permits", type: "EXPENSE" },
      { code: "5320", name: "Tyres", type: "EXPENSE" },
      { code: "5330", name: "Vehicle maintenance", type: "EXPENSE" },
      { code: "4200", name: "Detention and standing time", type: "INCOME" },
    ],
    watches: {
      COO: "Empty running, detention at the gate, fuel per 100 km, services due by the odometer, loads over the limit.",
      CFO: "Cost per kilometre, fuel as a share of revenue, recoverable costs that never reach an invoice.",
      LEGAL: "PDPs, operator cards, cross-border permits, and owner-drivers whose cover lapses.",
      CEO: "Which lanes lose money on every run, and which vehicle earns its keep.",
    },
  },
  SERVICES: {
    label: "Trades & field services",
    emphasis: ["eff:site-time:", "coo:overdue-jobs", "sales:reading:", "eff:route:", "cfo:unclassified-spend", "eff:fleet-share"],
    accounts: [
      { code: "5010", name: "Materials used on jobs", type: "EXPENSE" },
      { code: "1150", name: "Retention held by customers", type: "ASSET" },
    ],
    watches: {
      COO: "Jobs scheduled and never closed, time on site against time quoted, the order of the day's stops.",
      SALES: "Quotes being read and not answered, customers whose call-outs have stopped.",
      CFO: "Materials bought for a job and never billed, retention still held.",
    },
  },
  RETAIL: {
    label: "Retail",
    emphasis: ["cfo:margin-erosion", "cons:supplier:", "cons:timing:", "sales:discounting", "cfo:vat-spent"],
    accounts: [
      { code: "5020", name: "Freight in", type: "EXPENSE" },
      { code: "5030", name: "Stock write-offs and shrinkage", type: "EXPENSE" },
    ],
    watches: {
      COO: "Stock turn, what is running out, what has not moved in months.",
      CFO: "Margin per product after supplier price rises, tax collected at the till.",
      EFFICIENCY: "The same stock bought from several suppliers at several prices.",
    },
  },
  WHOLESALE: {
    label: "Wholesale & distribution",
    emphasis: ["cons:supplier:", "cfo:overdue-debtors", "sales:quiet:", "coo:empty-running", "cfo:margin-erosion"],
    accounts: [{ code: "5020", name: "Freight in", type: "EXPENSE" }],
    watches: {
      SALES: "Trade customers whose order rhythm has broken.",
      CFO: "Debtor days, and margin after supplier increases.",
    },
  },
  MEDICAL: {
    label: "Practices & clinics",
    emphasis: ["cfo:overdue-debtors", "legal:tender-readiness", "legal:no-contracts", "cons:subscription:"],
    accounts: [{ code: "4300", name: "Medical aid receipts", type: "INCOME" }],
    watches: {
      CFO: "Claims unpaid by medical aids, and patient balances.",
      LEGAL: "Practice numbers, professional registrations and indemnity cover.",
    },
  },
  CORPORATE: {
    label: "Professional services",
    emphasis: ["cfo:overdue-debtors", "legal:notice:", "cons:subscription:", "ceo:concentration:"],
    accounts: [{ code: "5510", name: "Software subscriptions", type: "EXPENSE" }],
    watches: {
      CEO: "Dependence on a single client.",
      EFFICIENCY: "Subscriptions that overlap.",
      LEGAL: "Contracts renewing by themselves.",
    },
  },
  ECOMMERCE: {
    label: "Online retail",
    emphasis: ["cfo:margin-erosion", "cons:supplier:", "sales:discounting", "cons:subscription:"],
    accounts: [
      { code: "5040", name: "Payment gateway fees", type: "EXPENSE" },
      { code: "5050", name: "Courier costs", type: "EXPENSE" },
    ],
    watches: {
      CFO: "Margin after gateway fees, couriers and returns.",
      EFFICIENCY: "App subscriptions that overlap.",
    },
  },
  NONPROFIT: {
    label: "Non-profit",
    emphasis: ["cfo:cash-gap", "legal:tender-readiness", "cons:subscription:"],
    accounts: [{ code: "4400", name: "Donations and grants", type: "INCOME" }],
    watches: {
      CFO: "Cash runway against committed programmes.",
      LEGAL: "NPO registration, annual reports and funder compliance.",
    },
  },
};

export function packFor(niche: NicheSkin): IndustryPack {
  return PACKS[niche] ?? PACKS.SERVICES;
}

/** Give a workspace its trade's accounts. Additive, like the default chart. */
export async function ensurePackAccounts(tenantId: string): Promise<number> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { niche: true } });
  if (!t) return 0;
  const pack = packFor(t.niche);
  const have = new Set((await prisma.account.findMany({ where: { tenantId }, select: { code: true } })).map((a) => a.code));
  const missing = pack.accounts.filter((a) => !have.has(a.code));
  if (missing.length > 0) {
    await prisma.account.createMany({ data: missing.map((a) => ({ tenantId, code: a.code, name: a.name, type: a.type })) });
  }
  return missing.length;
}

// ---------------------------------------------------------------- turnaround

/** Findings about survival: cash, money owed, money spent that was not ours. */
export const SURVIVAL_PREFIXES = [
  "cfo:cash-gap", "cfo:overdue-debtors", "cfo:vat-spent", "cfo:trading-loss", "cfo:bank-unexplained",
  "coo:detention", "coo:recoverables", "cfo:duplicate:", "cons:subscription:",
];
/** Findings about optimisation and growth, which can wait while cash cannot. */
export const LATER_PREFIXES = ["ceo:concentration:", "sales:win-rate", "eff:route:", "eff:fleet-share", "cons:insurance", "cons:timing:", "legal:no-contracts"];

/**
 * How much more or less a finding should weigh for this workspace: the trade
 * pack lifts what matters in the trade, and turnaround mode reorders
 * everything around cash.
 */
export function weightFor(dedupeKey: string, ctx: { niche: NicheSkin; turnaround: boolean }): number {
  let w = 1;
  if (packFor(ctx.niche).emphasis.some((p) => dedupeKey.startsWith(p))) w *= 1.3;
  if (ctx.turnaround) {
    if (SURVIVAL_PREFIXES.some((p) => dedupeKey.startsWith(p))) w *= 2.5;
    else if (LATER_PREFIXES.some((p) => dedupeKey.startsWith(p))) w *= 0.3;
  }
  return w;
}

export async function setTurnaroundMode(tenantId: string, on: boolean) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { turnaroundMode: on } });
}
