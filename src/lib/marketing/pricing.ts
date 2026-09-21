// The pricing page's view of the plans.
//
// DERIVED, not declared. Every number here is computed from the billing
// engine's own plan table (src/lib/billing/plans.ts), so the page cannot
// advertise a price the product will not charge — which is exactly what had
// happened: the site offered plans at $19/$49 that nothing in the app could
// enforce, alongside a one-click export the product deliberately does not
// provide.
//
// What this file legitimately adds is presentation: how a price is written
// for somebody reading it, which card is featured, and what the button says.
// If you are changing what a plan COSTS, change plans.ts. There is a drift
// test that fails if these two ever disagree.

import { PLATFORM_CURRENCY } from "@/lib/brand";
import { formatMoney } from "@/lib/format/money";
import {
  PLANS,
  TRIAL_DAYS as TRIAL_DAYS_SOURCE,
  type Plan,
  type PlanKey,
} from "@/lib/billing/plans";

export const TRIAL_DAYS = TRIAL_DAYS_SOURCE;

export interface PricingPlan {
  id: PlanKey;
  name: string;
  price: string;
  priceNote: string;
  seatsIncluded: number;
  extraSeatPrice: string | null;
  aiNote: string;
  description: string;
  features: string[];
  cardVariant: "kb-card-outline" | "kb-card-accent" | "kb-card-dark";
  ctaLabel: string;
  ctaHref: string;
}

// Prices are in the platform's currency, whatever that is set to — written
// through the same formatter as every other figure in the app rather than
// with a hardcoded symbol, so that changing what we bill in changes the
// website too.
function dollars(cents: number): string {
  return formatMoney(cents, PLATFORM_CURRENCY, { decimals: cents % 100 !== 0 });
}

/** How this plan's price is written on a page somebody is reading. */
function headline(plan: Plan): { price: string; note: string } {
  // The note carries the whole qualifier. The page used to append "/mo"
  // itself, which read as "$29/mo /month, including 3 seats" the moment the
  // note started saying anything more specific than a period.
  if (plan.quoted) return { price: "Custom", note: `volume seats from ${dollars(plan.fullSeatCents)} each` };
  if (plan.baseCents > 0) {
    return {
      price: dollars(plan.baseCents),
      note: `a month, including ${plan.seatsIncluded} seats`,
    };
  }
  return { price: dollars(plan.fullSeatCents), note: "per seat, per month" };
}

const PRESENTATION: Record<PlanKey, { variant: PricingPlan["cardVariant"]; cta: string; href: string }> = {
  solo: { variant: "kb-card-outline", cta: "Start free trial", href: "/signup" },
  pro: { variant: "kb-card-accent", cta: "Start free trial", href: "/signup" },
  business: { variant: "kb-card-outline", cta: "Start free trial", href: "/signup" },
  enterprise: { variant: "kb-card-dark", cta: "Talk to us", href: "/pricing" },
};

export const PRICING_PLANS: PricingPlan[] = PLANS.map((plan) => {
  const { price, note } = headline(plan);
  const presentation = PRESENTATION[plan.key];
  return {
    id: plan.key,
    name: plan.name,
    price,
    priceNote: note,
    seatsIncluded: plan.seatsIncluded,
    // Only worth saying where seats are included in a base price; on a
    // per-seat plan the headline already is the seat price.
    extraSeatPrice: plan.seatsIncluded > 0 ? `${dollars(plan.fullSeatCents)}/seat` : null,
    aiNote:
      `Includes about ${dollars(plan.agentAllowanceCentsPerSeat)} of AI work per seat each month — ` +
      `far more than a normal working month uses. Field seats are ${dollars(plan.fieldSeatCents)}; ` +
      `customers, suppliers and your accountant are free.`,
    description: plan.summary,
    features: plan.features,
    cardVariant: presentation.variant,
    ctaLabel: presentation.cta,
    ctaHref: presentation.href,
  };
});
