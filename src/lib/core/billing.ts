// What a workspace is paying, and what it costs us to serve.
//
// Both halves live here deliberately. A billing module that knows revenue but
// not cost is how a business discovers, a year in, that its most engaged
// customers are its least profitable ones — which is the specific failure
// mode of selling an agent on a flat seat price. Every figure a person sees
// about their own bill comes from here, and so does the margin view that
// tells us whether the price is right.
//
// The plan's own numbers are in src/lib/billing/plans.ts. This module holds
// what is true of a particular workspace: who is in it, what state its
// subscription is in, and what its agent actually spent.

import { prisma } from "@/lib/db";
import { recordAudit } from "./audit";
import {
  PLAN_BY_KEY,
  TRIAL_DAYS,
  allowanceCents,
  monthlyCents,
  planFor,
  type Plan,
  type PlanKey,
  type SeatClass,
  type SeatCounts,
} from "@/lib/billing/plans";
import { spendThisMonth } from "@/lib/agent/budget";
import { PLATFORM_CURRENCY } from "@/lib/brand";
import { formatMoney } from "@/lib/format/money";

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

/**
 * Which seat a role occupies, unless somebody said otherwise.
 *
 * Drivers and technicians work in the field: they clock on, photograph proof
 * and close jobs. Charging a full seat for that is how a plumbing business
 * with six vans concludes this software is for somebody else.
 */
export function defaultSeatClass(role: string): SeatClass {
  return role === "DRIVER" || role === "TECHNICIAN" ? "field" : "full";
}

export function seatClassOf(member: { role: string; seatClass?: string | null }): SeatClass {
  const stored = member.seatClass;
  if (stored === "full" || stored === "field" || stored === "portal") return stored;
  return defaultSeatClass(member.role);
}

/**
 * Who is in this workspace, by what they cost.
 *
 * Portal seats are counted from the people who actually hold a portal link —
 * customers and suppliers — not from memberships. A portal user never has a
 * membership, so counting them there returned zero for every workspace and
 * the "Portal — free" line was a claim about nothing.
 */
export async function seatCounts(tenantId: string): Promise<SeatCounts> {
  const [members, portal] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      select: { role: true, seatClass: true },
    }),
    prisma.party.count({ where: { tenantId, portalToken: { not: null } } }),
  ]);

  const counts: SeatCounts = { full: 0, field: 0, portal };
  // A membership explicitly marked "portal" is a person with a login who is
  // nonetheless billed as a portal user. Rare, and it adds to the same total
  // rather than being dropped.
  for (const member of members) counts[seatClassOf(member)] += 1;
  return counts;
}

/**
 * The subscription, or what it would be if nobody has touched it yet.
 *
 * READ-ONLY. It used to find-or-create, which turned every read into a write
 * and had two consequences, both bad: loading the platform margin view
 * created a row for every workspace on the platform, and each of those rows
 * started a fresh fourteen-day trial — for businesses that had been using the
 * product for a year.
 *
 * So a workspace with no row gets a default derived from when it was created
 * rather than from now. A business that signed up last year is out of trial,
 * which is the truth, and nothing is written until somebody actually picks a
 * plan.
 */
export async function subscriptionFor(tenantId: string, now = new Date()) {
  const existing = await prisma.subscription.findUnique({ where: { tenantId } });
  if (existing) return existing;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { createdAt: true },
  });
  const started = tenant?.createdAt ?? now;

  return {
    id: "",
    tenantId,
    planKey: "pro",
    status: "TRIALING",
    trialEndsAt: new Date(started.getTime() + TRIAL_DAYS * 86_400_000),
    periodStart: started,
    cancelAt: null,
    agreedFullSeatCents: null,
    agreedNote: null,
    createdAt: started,
    updatedAt: started,
  };
}

/**
 * Write the row, for the first time if need be.
 *
 * The one place a subscription is created. Called only from the lifecycle
 * functions below, so that creating a subscription is always something
 * somebody did rather than something a page load caused.
 */
async function persist(tenantId: string, data: Record<string, unknown>, now = new Date()) {
  const current = await subscriptionFor(tenantId, now);
  await prisma.subscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      planKey: current.planKey,
      status: current.status,
      trialEndsAt: current.trialEndsAt,
      periodStart: current.periodStart,
      ...data,
    },
    update: data,
  });
}

export interface Bill {
  plan: Plan;
  status: SubscriptionStatus;
  seats: SeatCounts;
  /** What this month costs them, in cents. */
  totalCents: number;
  /** Their agent allowance for the month, in cents of model spend. */
  allowanceCents: number;
  /** What the agent has actually spent this month, in cents. */
  agentSpentCents: number;
  /** 0-100+, for the bar on the usage page. */
  allowanceUsedPercent: number;
  trialDaysLeft: number | null;
  /** One sentence, in plain words. */
  summary: string;
}

/** Everything a workspace owner should be able to see about their own bill. */
export async function billFor(tenantId: string, now = new Date()): Promise<Bill> {
  const [subscription, seats, spend] = await Promise.all([
    subscriptionFor(tenantId, now),
    seatCounts(tenantId),
    spendThisMonth(tenantId, now),
  ]);

  const plan = planFor(subscription.planKey);
  // A quoted deal overrides the list price, and only ever downward in
  // practice. Applied here rather than by editing the plan, so the plan a
  // workspace is on stays legible.
  const effective: Plan =
    subscription.agreedFullSeatCents !== null
      ? { ...plan, fullSeatCents: subscription.agreedFullSeatCents }
      : plan;

  const totalCents = monthlyCents(effective, seats);
  const allowance = allowanceCents(effective, seats);
  const spentCents = spend.costCents;
  const status = subscription.status as SubscriptionStatus;

  const trialDaysLeft =
    status === "TRIALING" && subscription.trialEndsAt
      ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
      : null;

  return {
    plan: effective,
    status,
    seats,
    totalCents,
    allowanceCents: allowance,
    agentSpentCents: spentCents,
    allowanceUsedPercent: allowance > 0 ? Math.round((spentCents / allowance) * 100) : 0,
    trialDaysLeft,
    summary: summarise({ plan: effective, status, seats, totalCents, trialDaysLeft }),
  };
}

function summarise(params: {
  plan: Plan;
  status: SubscriptionStatus;
  seats: SeatCounts;
  totalCents: number;
  trialDaysLeft: number | null;
}): string {
  const { plan, status, seats, totalCents, trialDaysLeft } = params;
  // The platform's own currency, not the workspace's: a plan is priced in
  // what we charge, and a South African workspace on a dollar plan should see
  // the dollar figure it will actually be billed.
  const money = formatMoney(totalCents, PLATFORM_CURRENCY, { decimals: true });
  const people = `${seats.full} full seat${seats.full === 1 ? "" : "s"}${
    seats.field > 0 ? ` and ${seats.field} field seat${seats.field === 1 ? "" : "s"}` : ""
  }`;

  if (status === "TRIALING") {
    return trialDaysLeft === 0
      ? `Your trial has ended. On ${plan.name}, ${people} would be ${money} a month.`
      : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left of your trial. After that, ${people} on ${plan.name} is ${money} a month.`;
  }
  if (status === "CANCELLED") return "Cancelled. You keep access until the end of the month you have paid for.";
  if (status === "PAST_DUE") return `${money} is outstanding. Nothing has been switched off.`;
  return `${people} on ${plan.name} — ${money} a month.`;
}

// ------------------------------------------------------------------ margin

export interface Margin {
  tenantId: string;
  name: string;
  planKey: PlanKey;
  status: SubscriptionStatus;
  /** What they pay us this month, in cents. */
  revenueCents: number;
  /** What their agent cost us this month, in cents. */
  agentCostCents: number;
  /** Revenue minus cost. Negative is the number that matters. */
  grossCents: number;
  /** Cost as a percentage of revenue. Null when they pay nothing yet. */
  costRatio: number | null;
  seats: SeatCounts;
}

/**
 * Where the money actually goes, per workspace.
 *
 * The instrument that tells us the price is wrong before the market does.
 * Only agent spend is counted as cost today — messaging and storage are real
 * marginal costs too and belong here as soon as they are metered, which is
 * why the field is named for the cost it holds rather than for "cost".
 */
/**
 * How many workspaces one page may account for.
 *
 * A limit rather than everything, because this reads several tables at once
 * and an unbounded platform-wide scan is the thing that takes a dashboard
 * down at exactly the moment there are enough customers to care about.
 */
const MARGIN_SCAN_LIMIT = 2_000;

export async function margins(now = new Date()): Promise<Margin[]> {
  // Four queries, not three per workspace.
  //
  // This read the whole bill for each tenant in turn — three queries each,
  // fine at ten workspaces and fifteen hundred queries at five hundred, on a
  // page one person opens to see whether the pricing works.
  //
  // It also only considers workspaces that pay something or cost something.
  // A margin view of a workspace with no subscription and no agent spend is a
  // row of zeroes, and there will be far more of those than of the rows
  // somebody opened this page to read.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [subscriptions, spend] = await Promise.all([
    prisma.subscription.findMany({ take: MARGIN_SCAN_LIMIT }),
    prisma.agentSpend.groupBy({
      by: ["tenantId"],
      where: { at: { gte: monthStart } },
      _sum: { costCents: true },
      // Prisma requires an order when a groupBy is limited, which is fair:
      // "the first 2000" is meaningless without one. Biggest spenders first,
      // which is also the order this page cares about.
      orderBy: { _sum: { costCents: "desc" } },
      take: MARGIN_SCAN_LIMIT,
    }),
  ]);

  const ids = [...new Set([...subscriptions.map((s) => s.tenantId), ...spend.map((s) => s.tenantId)])];
  if (ids.length === 0) return [];

  const [tenants, members] = await Promise.all([
    prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, take: MARGIN_SCAN_LIMIT }),
    prisma.membership.findMany({
      where: { tenantId: { in: ids } },
      select: { tenantId: true, role: true, seatClass: true },
      take: MARGIN_SCAN_LIMIT * 20,
    }),
  ]);

  const subscriptionBy = new Map(subscriptions.map((s) => [s.tenantId, s]));
  const spendBy = new Map(spend.map((s) => [s.tenantId, s._sum.costCents ?? 0]));

  // Portal holders are deliberately not counted here, unlike seatCounts:
  // they are free, so they change no figure on this page, and counting them
  // would be another query for a column nobody reads.
  const seatsBy = new Map<string, SeatCounts>();
  for (const member of members) {
    const counts = seatsBy.get(member.tenantId) ?? { full: 0, field: 0, portal: 0 };
    counts[seatClassOf(member)] += 1;
    seatsBy.set(member.tenantId, counts);
  }

  return tenants
    .map((tenant) => {
      const subscription = subscriptionBy.get(tenant.id);
      const seats = seatsBy.get(tenant.id) ?? { full: 0, field: 0, portal: 0 };
      const status = (subscription?.status ?? "TRIALING") as SubscriptionStatus;

      const plan = planFor(subscription?.planKey);
      const effective: Plan =
        subscription?.agreedFullSeatCents != null
          ? { ...plan, fullSeatCents: subscription.agreedFullSeatCents }
          : plan;

      // A workspace that has never picked a plan pays nothing, whatever its
      // seat count would imply.
      const revenueCents = status === "ACTIVE" || status === "PAST_DUE" ? monthlyCents(effective, seats) : 0;
      const agentCostCents = spendBy.get(tenant.id) ?? 0;

      return {
        tenantId: tenant.id,
        name: tenant.name,
        planKey: effective.key,
        status,
        revenueCents,
        agentCostCents,
        grossCents: revenueCents - agentCostCents,
        costRatio: revenueCents > 0 ? Math.round((agentCostCents / revenueCents) * 100) : null,
        seats,
      };
    })
    .sort((a, b) => a.grossCents - b.grossCents);
}

export async function overBudgetWorkspaces(thresholdPercent = 40, now = new Date()): Promise<Margin[]> {
  const all = await margins(now);
  return all.filter((row) => row.costRatio !== null && row.costRatio >= thresholdPercent);
}

// ------------------------------------------------------------- lifecycle

/**
 * Every change to what a workspace pays leaves a record.
 *
 * Money questions are argued about months later, and "who downgraded us in
 * March" has no answer without this. Never throws into the caller: a missing
 * audit line is smaller than a subscription change that failed to apply.
 */
async function auditBilling(
  tenantId: string,
  what: string,
  detail: Record<string, unknown>,
  actorId?: string | null
): Promise<void> {
  await recordAudit({
    tenantId,
    actorType: actorId ? "user" : "system",
    actorId: actorId ?? undefined,
    capability: "staff:manage",
    targetType: "Subscription",
    targetId: tenantId,
    metadata: { what, ...detail },
  }).catch((err) => console.error("[billing] could not record the change:", err));
}

export async function setPlan(tenantId: string, planKey: PlanKey, actorId?: string | null): Promise<void> {
  if (!PLAN_BY_KEY[planKey]) throw new Error("That is not a plan.");
  await persist(tenantId, { planKey });
  await auditBilling(tenantId, "plan", { planKey }, actorId);
}

/**
 * Start paying.
 *
 * Kept separate from setPlan because changing plan and starting to pay are
 * different decisions, and a workspace that switches plan mid-trial should
 * not lose the rest of its trial for it.
 */
export async function activate(tenantId: string, now = new Date(), actorId?: string | null): Promise<void> {
  await persist(tenantId, { status: "ACTIVE", periodStart: now, cancelAt: null }, now);
  await auditBilling(tenantId, "activated", {}, actorId);
}

export async function cancel(tenantId: string, now = new Date(), actorId?: string | null): Promise<void> {
  // Access continues to the end of the paid month. Cutting a business off
  // from its own records the moment it cancels is both unkind and, where the
  // records are invoices somebody has to keep for years, indefensible.
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await persist(tenantId, { status: "CANCELLED", cancelAt: endOfMonth }, now);
  await auditBilling(tenantId, "cancelled", { accessUntil: endOfMonth.toISOString() }, actorId);
}
