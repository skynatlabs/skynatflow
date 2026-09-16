// Can I afford it?
//
// The question every owner actually has, and the one the whole ledger exists
// to answer. The cash forecast already projects thirteen weeks from real
// commitments; this asks what those weeks look like with one more thing in
// them — a hire, a vehicle, a machine, a month of rent somewhere bigger.
//
// Three rules keep this from becoming a fortune-teller:
//
//   IT IS THE SAME FORECAST. No second model of the business. The scenario is
//   added to the forecast the business already sees, so the two can never
//   disagree and a decision is made against the same numbers as everything
//   else.
//
//   IT ANSWERS IN WEEKS, NOT YES OR NO. "Yes" is a claim about the future.
//   "This takes the lowest point from R40 000 to R6 000 in week nine" is a
//   fact about the arithmetic, and it is the sentence somebody can act on.
//
//   IT CARRIES THE FORECAST'S OWN CAVEATS. The forecast says what it does not
//   know; an answer built on it that drops those is worse than no answer.

import { prisma } from "@/lib/db";
import { buildCashForecast } from "./cashForecast";
import { formatMoney } from "@/lib/format/money";

export type Recurrence = "once" | "monthly";

export interface Commitment {
  label: string;
  amountCents: number;
  recurrence: Recurrence;
  /** Weeks from now it starts. */
  startsInWeeks?: number;
  /** Money coming in rather than going out — the other half of a hire. */
  inflow?: boolean;
}

export interface WhatIfAnswer {
  currency: string;
  question: string;
  /** Lowest point on the forecast as it stands. */
  lowestNowCents: number;
  lowestNowWeek: number;
  /** And with the commitment in it. */
  lowestThenCents: number;
  lowestThenWeek: number;
  /** The week it first goes below nothing, if it does. */
  goesShortInWeek: number | null;
  affordable: boolean;
  /** The sentence to read out. */
  answer: string;
  caveats: string[];
  weeks: Array<{ week: number; weekStart: string; nowCents: number; thenCents: number }>;
}

/** Common shapes, so the question does not have to be typed as arithmetic. */
export function hiringSomebody(params: { role: string; monthlyCostCents: number; startsInWeeks?: number }): Commitment {
  return {
    // The real cost of somebody is not their salary — the on-costs are
    // roughly a fifth on top, and a forecast built on the salary alone is the
    // one that makes a business hire somebody it cannot keep.
    label: `${params.role} (salary plus about 20% in on-costs)`,
    amountCents: Math.round(params.monthlyCostCents * 1.2),
    recurrence: "monthly",
    startsInWeeks: params.startsInWeeks ?? 4,
  };
}

export function buyingSomething(params: { what: string; priceCents: number; overMonths?: number; inWeeks?: number }): Commitment {
  if (!params.overMonths || params.overMonths <= 1) {
    return { label: params.what, amountCents: params.priceCents, recurrence: "once", startsInWeeks: params.inWeeks ?? 0 };
  }
  return {
    label: `${params.what}, over ${params.overMonths} months`,
    amountCents: Math.round(params.priceCents / params.overMonths),
    recurrence: "monthly",
    startsInWeeks: params.inWeeks ?? 0,
  };
}

export async function whatIf(params: {
  tenantId: string;
  question: string;
  commitments: Commitment[];
  openingCents?: number;
}): Promise<WhatIfAnswer> {
  const [forecast, tenant] = await Promise.all([
    buildCashForecast({ tenantId: params.tenantId, openingCents: params.openingCents ?? 0 }),
    prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { currency: true } }),
  ]);
  const money = (c: number) => formatMoney(c, tenant.currency);

  // The commitment, spread across the same weeks the forecast uses. A monthly
  // cost is a quarter of itself each week rather than a lump on one — a
  // business pays rent monthly and feels it weekly.
  const perWeek = forecast.weeks.map(() => 0);
  for (const commitment of params.commitments) {
    const from = Math.max(0, commitment.startsInWeeks ?? 0);
    const sign = commitment.inflow ? 1 : -1;
    if (commitment.recurrence === "once") {
      if (from < perWeek.length) perWeek[from] += sign * commitment.amountCents;
    } else {
      const weekly = commitment.amountCents / 4.33;
      for (let i = from; i < perWeek.length; i++) perWeek[i] += sign * weekly;
    }
  }

  let running = 0;
  const weeks = forecast.weeks.map((week, i) => {
    running += perWeek[i];
    return {
      week: i + 1,
      weekStart: week.weekStart,
      nowCents: week.closingCents,
      thenCents: Math.round(week.closingCents + running),
    };
  });

  const lowestThen = weeks.reduce((worst, w) => (w.thenCents < worst.thenCents ? w : worst), weeks[0]);
  const short = weeks.find((w) => w.thenCents < 0) ?? null;
  const affordable = short === null;

  const total = params.commitments
    .map((c) => (c.recurrence === "monthly" ? `${money(c.amountCents)} a month` : money(c.amountCents)))
    .join(" and ");

  return {
    currency: tenant.currency,
    question: params.question,
    lowestNowCents: forecast.lowestCents,
    lowestNowWeek: forecast.lowestWeek + 1,
    lowestThenCents: lowestThen.thenCents,
    lowestThenWeek: lowestThen.week,
    goesShortInWeek: short?.week ?? null,
    affordable,
    answer: affordable
      ? `${total} takes the lowest point over the next thirteen weeks from ${money(forecast.lowestCents)} to ` +
        `${money(lowestThen.thenCents)}, in week ${lowestThen.week}. It does not go short.`
      : `${total} takes the account below nothing in week ${short!.week} — ${money(short!.thenCents)}. ` +
        `As it stands the lowest point is ${money(forecast.lowestCents)} in week ${forecast.lowestWeek + 1}.`,
    // The forecast's own caveats travel with the answer. Dropping them would
    // turn a projection into a promise.
    caveats: forecast.caveats,
    weeks,
  };
}

/** The most it could take on without going short. Answered by bisection. */
export async function howMuchCanWeAfford(params: {
  tenantId: string;
  recurrence: Recurrence;
  startsInWeeks?: number;
  openingCents?: number;
}): Promise<{ amountCents: number; answer: string; caveats: string[] }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { currency: true } });

  let low = 0;
  let high = 500_000_00;
  let caveats: string[] = [];

  for (let i = 0; i < 18; i++) {
    const mid = Math.round((low + high) / 2);
    const answer = await whatIf({
      tenantId: params.tenantId,
      question: "how much",
      openingCents: params.openingCents,
      commitments: [{ label: "this", amountCents: mid, recurrence: params.recurrence, startsInWeeks: params.startsInWeeks }],
    });
    caveats = answer.caveats;
    if (answer.affordable) low = mid;
    else high = mid;
  }

  const rounded = Math.floor(low / 10_000) * 10_000;
  return {
    amountCents: rounded,
    answer:
      rounded === 0
        ? "Nothing, on these numbers — the forecast is already at its limit."
        : `About ${formatMoney(rounded, tenant.currency)}${params.recurrence === "monthly" ? " a month" : ""} before the next thirteen weeks go short.`,
    caveats,
  };
}
