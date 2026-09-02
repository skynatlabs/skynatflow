// Single source of truth for the plans shown at the bottom of every
// marketing page (see PricingCards.tsx) and referenced anywhere else
// pricing needs to be quoted. Change the numbers here, not per-component.
//
// The structure: AI features (follow-up drafts, email triage, voice) carry
// a real per-call LLM cost, so they're gated to Growth+ rather than
// included free/unlimited on Starter — a flat cheap tier with unlimited AI
// is the one shape of pricing that can actually lose money per customer.
// One workspace = one subscription; multi-org is an Enterprise trait, not
// a loophole on the cheap tier.
export interface PricingPlan {
  id: "starter" | "growth" | "enterprise";
  name: string;
  price: string;
  priceNote: string;
  seatsIncluded: number;
  extraSeatPrice: string | null;
  description: string;
  features: string[];
  cardVariant: "kb-card-outline" | "kb-card-accent" | "kb-card-dark";
  ctaLabel: string;
  ctaHref: string;
}

export const TRIAL_DAYS = 14;

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$19",
    priceNote: "/month per organization",
    seatsIncluded: 3,
    extraSeatPrice: "$6/seat",
    description: "Quotes, invoices, and the customer portal — everything a solo operator needs to leave spreadsheets behind.",
    features: [
      "Unlimited quotes & invoices",
      "Customer self-service portal",
      "E-signatures & CSV import/export",
      "3 staff seats included",
    ],
    cardVariant: "kb-card-outline",
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "growth",
    name: "Growth",
    price: "$49",
    priceNote: "/month per organization",
    seatsIncluded: 5,
    extraSeatPrice: "$8/seat",
    description: "Everything in Starter, plus the AI engine that chases quiet leads and overdue invoices for you.",
    features: [
      "Everything in Starter",
      "AI follow-ups & abandoned-quote recovery",
      "Inventory demand heatmap, POS, rentals",
      "5 staff seats included",
    ],
    cardVariant: "kb-card-accent",
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    priceNote: "multi-location & multi-org",
    seatsIncluded: 0,
    extraSeatPrice: null,
    description: "Same engine, not a different product — for businesses running multiple locations or organizations under one account.",
    features: [
      "Everything in Growth",
      "Multi-location & multi-organization",
      "Dedicated onboarding",
      "Priority support",
    ],
    cardVariant: "kb-card-dark",
    ctaLabel: "Talk to us",
    ctaHref: "/pricing",
  },
];
