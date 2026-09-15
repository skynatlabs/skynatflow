// The chief executive.
//
// Reads all of it over months and says which of it matters: which customers
// to keep, which work to stop, where the next hire or vehicle pays for
// itself. Proposes only — capped at SUGGEST in the ladder, whatever anyone
// sets — and always with the facts that led there.
//
// The facts are arithmetic and the arithmetic is tested. Customer margins,
// lane margins, what a vehicle costs against what it does, how much of the
// revenue one customer is: these are computed here without a model, so the
// CEO still speaks on the day the AI provider is down and so its judgement
// can be checked in a test that seeds three months of data and asks which
// customer it names. A model is used for one thing only — turning a fact
// into the sentence a chief executive would say about it — and when there is
// no model the template sentence stands, plainer but no less true.
//
// Monthly, not daily. Strategy that changes every morning is not strategy.

import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAiModel } from "@/lib/ai/model";
import { observe, handOff, type ObserveParams } from "../observations";
import { assetCosts, customerMargins, laneMargins, lastDays } from "@/lib/core/costing";
import { valueSummary } from "@/lib/core/valueLedger";
import { formatMoney, tenantCurrency } from "@/lib/core/currency";

type Finding = Omit<ObserveParams, "tenantId" | "officer">;

/** How often the CEO speaks. */
export const CEO_CADENCE_DAYS = 27;
const LOOKBACK_DAYS = 90;

// ------------------------------------------------------------------ facts

interface Fact {
  finding: Finding;
  /** The bare facts, for the model to phrase or a test to read. */
  facts: string[];
}

/** A customer who costs more to serve than they pay. */
async function customerToStop(tenantId: string, currency: string): Promise<Fact | null> {
  const customers = await customerMargins(tenantId, lastDays(LOOKBACK_DAYS));
  const material = customers.filter((c) => c.jobs >= 2 && c.revenueCents >= 5_000_00);
  const worst = material.find((c) => c.marginCents < 0);
  if (!worst) return null;
  const money = (c: number) => formatMoney(c, currency);
  const facts = [
    `${worst.partyName}: ${worst.jobs} jobs in ${LOOKBACK_DAYS} days`,
    `Invoiced ${money(worst.revenueCents)}, cost ${money(worst.costCents)} to serve`,
    `Margin ${money(worst.marginCents)} (${worst.marginPercent ?? 0}%)`,
    worst.travelPriced ? "Travel priced from the fleet's real per-kilometre cost" : "Some travel could not be priced, so the loss is understated",
  ];
  return {
    facts,
    finding: {
      headline: `${worst.partyName} cost ${money(Math.abs(worst.marginCents))} more to serve than they paid over ${LOOKBACK_DAYS} days.`,
      detail: `${worst.jobs} jobs, ${money(worst.revenueCents)} invoiced, ${money(worst.costCents)} in goods, tagged costs and travel. Either the price goes up or the work stops; carrying on as is means paying to work for them.`,
      dedupeKey: `ceo:customer-loss:${worst.partyId}`,
      subjectType: "customer",
      subjectId: worst.partyId,
      moneyCents: Math.abs(worst.marginCents) * (365 / LOOKBACK_DAYS),
      confidence: worst.travelPriced ? 70 : 55,
      evidence: facts.map((f, i) => ({ label: ["Customer", "Money", "Margin", "Basis"][i], value: f })),
      proposedAction: `Reprice ${worst.partyName}'s next job to cover its real cost, and if they will not pay it, let the work go.`,
    },
  };
}

/** A lane that loses money every time it is driven. */
async function laneToDrop(tenantId: string, currency: string): Promise<Fact | null> {
  const lanes = await laneMargins(tenantId, lastDays(LOOKBACK_DAYS));
  // A lane whose stops carry no invoices has unknown revenue, not zero —
  // calling that a loss would be the CEO mistaking a data gap for a verdict.
  const worst = lanes.find((l) => l.priced && l.trips >= 3 && l.linkedStops > 0 && l.marginCents < 0);
  if (!worst) return null;
  const money = (c: number) => formatMoney(c, currency);
  const facts = [
    `Lane ${worst.laneKey}: ${worst.trips} runs, ${worst.km} km`,
    `Earned ${money(worst.revenueCents)} against ${money(worst.costCents)} of running cost`,
    `${money(worst.marginCents)} in total, ${worst.marginPerKmCents !== null ? money(worst.marginPerKmCents) : "—"} per kilometre`,
  ];
  return {
    facts,
    finding: {
      headline: `Every run down ${worst.laneKey} loses money — ${money(Math.abs(worst.marginCents))} over ${worst.trips} runs.`,
      detail: `${worst.km} km driven for ${money(worst.revenueCents)} of invoices, at a running cost of ${money(worst.costCents)}. The lane needs a higher rate, a return load, or fewer runs.`,
      dedupeKey: `ceo:lane-loss:${worst.laneKey}`,
      moneyCents: Math.abs(worst.marginCents) * (365 / LOOKBACK_DAYS),
      confidence: 60,
      evidence: facts.map((f, i) => ({ label: ["Lane", "Money", "Result"][i], value: f })),
      proposedAction: `Quote ${worst.laneKey} at a rate that covers ${money(worst.costCents / Math.max(1, worst.km))} a kilometre, or stop taking it without a return load.`,
    },
  };
}

/** A vehicle whose fixed costs outrun its use — the "next vehicle" question, asked backwards. */
async function underusedAsset(tenantId: string, currency: string): Promise<Fact | null> {
  const assets = await assetCosts(tenantId, lastDays(LOOKBACK_DAYS));
  const vehicles = assets.filter((a) => a.capacityUnit === "KM" && a.totalCents > 0);
  if (vehicles.length < 2) return null;
  const totalKm = vehicles.reduce((s, a) => s + a.units, 0);
  if (totalKm === 0) return null;
  const avgKm = totalKm / vehicles.length;
  const idle = vehicles
    .filter((a) => a.units < avgKm * 0.35 && a.obligationCents + a.depreciationCents > 0)
    .sort((a, b) => b.obligationCents + b.depreciationCents - (a.obligationCents + a.depreciationCents))[0];
  if (!idle) return null;
  const fixed = idle.obligationCents + idle.depreciationCents;
  const money = (c: number) => formatMoney(c, currency);
  const facts = [
    `${idle.name}: ${Math.round(idle.units)} km in ${LOOKBACK_DAYS} days against a fleet average of ${Math.round(avgKm)}`,
    `Fixed cost ${money(fixed)} over the period whether it moves or not (cover, licence, depreciation)`,
    `All in, ${money(idle.totalCents)}${idle.costPerUnitCents ? ` — ${money(idle.costPerUnitCents)} a kilometre` : ""}`,
  ];
  return {
    facts,
    finding: {
      headline: `${idle.name} did ${Math.round(idle.units)} km in three months and cost ${money(fixed)} standing still.`,
      detail: `The rest of the fleet averaged ${Math.round(avgKm)} km. Its fixed costs run whether it moves or not; the work it does could go on the others, and the vehicle could go.`,
      dedupeKey: `ceo:underused:${idle.assetId}`,
      subjectType: "asset",
      subjectId: idle.assetId,
      moneyCents: fixed * (365 / LOOKBACK_DAYS),
      confidence: idle.confidence === "HIGH" ? 65 : idle.confidence === "MEDIUM" ? 50 : 35,
      evidence: facts.map((f, i) => ({ label: ["Use", "Fixed cost", "All in"][i], value: f })),
      proposedAction: `Move ${idle.name}'s runs onto the other vehicles for a month. If nothing slips, sell it.`,
    },
  };
}

/** One customer too big to lose. */
async function concentrationRisk(tenantId: string, currency: string): Promise<Fact | null> {
  const customers = await customerMargins(tenantId, lastDays(LOOKBACK_DAYS));
  const total = customers.reduce((s, c) => s + c.revenueCents, 0);
  if (total < 20_000_00 || customers.length < 3) return null;
  const biggest = [...customers].sort((a, b) => b.revenueCents - a.revenueCents)[0];
  const share = biggest.revenueCents / total;
  if (share < 0.4) return null;
  const money = (c: number) => formatMoney(c, currency);
  const pct = Math.round(share * 100);
  const facts = [
    `${biggest.partyName} is ${pct}% of revenue: ${money(biggest.revenueCents)} of ${money(total)}`,
    `${customers.length} customers invoiced in ${LOOKBACK_DAYS} days`,
  ];
  return {
    facts,
    finding: {
      headline: `${biggest.partyName} is ${pct}% of everything you invoiced in three months.`,
      detail: `${money(biggest.revenueCents)} of ${money(total)}. Losing them is not losing a customer, it is losing the business; the next two customers found are worth more than the next two jobs for them.`,
      dedupeKey: `ceo:concentration:${biggest.partyId}`,
      subjectType: "customer",
      subjectId: biggest.partyId,
      moneyCents: biggest.revenueCents * (365 / LOOKBACK_DAYS),
      confidence: 75,
      evidence: facts.map((f, i) => ({ label: ["Share", "Customers"][i], value: f })),
      proposedAction: "Give the sales consultant a target: two new customers this quarter in the same line of work, so no one account is the business.",
    },
  };
}

/** What the officers have been worth — the CEO reads its own team's ledger. */
async function teamReport(tenantId: string, currency: string): Promise<Fact | null> {
  const v = await valueSummary(tenantId, { months: 3 });
  if (v.totals.acceptedCents < 1_000_00) return null;
  const money = (c: number) => formatMoney(c, currency);
  const facts = [
    `Found ${money(v.totals.identifiedCents)}, accepted ${money(v.totals.acceptedCents)}, verified ${money(v.totals.realisedCents)}`,
    v.feeSet ? `Platform cost ${money(v.totals.costCents)}` : "Platform fee not set — no cost to compare against",
  ];
  const verified = v.verifiedPercent ?? 0;
  return {
    facts,
    finding: {
      headline: `In three months the officers put ${money(v.totals.identifiedCents)} in front of you; you took on ${money(v.totals.acceptedCents)}, and ${money(v.totals.realisedCents)} of it is verified in the data.`,
      detail: `${verified}% of what was accepted can be seen in the books. The rest is either still working through or was never followed up — the value page says which.`,
      dedupeKey: "ceo:team-report",
      moneyCents: v.totals.realisedCents,
      confidence: 90,
      evidence: facts.map((f, i) => ({ label: ["Value", "Cost"][i], value: f })),
      proposedAction: "Read the value page. Anything accepted and not verified after a month is a decision that was made and not carried out.",
    },
  };
}

// --------------------------------------------------------------- wording

const Phrasing = z.object({
  headline: z.string().describe("One sentence a chief executive would say about this, quoting the key figure. No hedging, no preamble."),
  proposedAction: z.string().describe("One sentence: the decision to make, concretely."),
});

/**
 * Let a model phrase a fact the way a chief executive would, when there is
 * one. Numbers are given and must be repeated, not recomputed; anything the
 * model returns that drops the figure is discarded in favour of the template.
 */
async function phrase(fact: Fact, currency: string, allowed: boolean): Promise<Finding> {
  // A test must never reach a provider: it would cost money, take seconds and
  // make the wording nondeterministic. The template is what gets asserted.
  if (!allowed || process.env.VITEST) return fact.finding;
  const model = await getAiModel();
  if (!model) return fact.finding;
  try {
    const { object } = await generateObject({
      model,
      // Wording is a nicety over a finding that is already complete. A slow
      // or failing provider gets one short try, then the template stands.
      abortSignal: AbortSignal.timeout(20_000),
      maxRetries: 1,
      schema: Phrasing,
      prompt:
        `You are the chief executive of a small business, reporting to its owner. Currency: ${currency}.\n` +
        `Facts, all computed and verified:\n${fact.facts.map((f) => `- ${f}`).join("\n")}\n\n` +
        `The current draft reads: "${fact.finding.headline}"\n` +
        `Write a better headline and a proposed action. Keep every figure exactly as given. Be direct; the owner is busy.`,
    });
    const keepsFigure = /\d/.test(object.headline);
    return keepsFigure
      ? { ...fact.finding, headline: object.headline, proposedAction: object.proposedAction }
      : fact.finding;
  } catch {
    return fact.finding;
  }
}

// ------------------------------------------------------------------- run

export interface CeoRun {
  ran: boolean;
  checked: number;
  observed: number;
  failed: string[];
  skipped?: string;
}

const CHECKS: Array<{ name: string; run: (t: string, c: string) => Promise<Fact | null> }> = [
  { name: "customerToStop", run: customerToStop },
  { name: "laneToDrop", run: laneToDrop },
  { name: "underusedAsset", run: underusedAsset },
  { name: "concentrationRisk", run: concentrationRisk },
  { name: "teamReport", run: teamReport },
];

/**
 * The CEO's monthly read. Pass `force` to run regardless of cadence — a
 * test, or an owner who asks.
 */
export async function runCEO(
  tenantId: string,
  opts: { now?: Date; force?: boolean; phrase?: boolean } = {}
): Promise<CeoRun> {
  const now = opts.now ?? new Date();
  if (!opts.force) {
    const last = await prisma.observation.findFirst({
      where: { tenantId, officer: "CEO" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && now.getTime() - last.createdAt.getTime() < CEO_CADENCE_DAYS * 86_400_000) {
      return { ran: false, checked: 0, observed: 0, failed: [], skipped: "spoke this month already" };
    }
  }

  const currency = await tenantCurrency(tenantId);
  let observed = 0;
  const failed: string[] = [];
  for (const check of CHECKS) {
    try {
      const fact = await check.run(tenantId, currency);
      if (!fact) continue;
      const finding = await phrase(fact, currency, opts.phrase ?? true);
      const written = await observe({ ...finding, tenantId, officer: "CEO" });
      if (written) {
        observed++;
        // Repricing a customer is the sales consultant's conversation to have.
        if (finding.dedupeKey.startsWith("ceo:customer-loss:")) {
          await handOff({ tenantId, observationId: written.id, to: "SALES", note: "Handed to sales: the repricing conversation is theirs." }).catch(() => undefined);
        }
      }
    } catch (err) {
      failed.push(check.name);
      console.error(`[ceo] ${check.name} failed for ${tenantId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { ran: true, checked: CHECKS.length, observed, failed };
}
