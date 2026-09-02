// Single source of truth for the plans shown at the bottom of every
// marketing page (see chrome.tsx's PricingTeaser) and the full /pricing
// page. Change the numbers here, not per-component.
//
// The structure: AI features (follow-up drafts, the AI PA command box,
// voice assistant) carry a real per-call LLM cost, so they're gated to
// Growth+ rather than included free/unlimited on Starter — a flat cheap
// tier with unlimited AI is the one shape of pricing that can actually
// lose money per customer. Extra-seat pricing on Growth/Enterprise is
// deliberately higher than Starter's ($8 vs $6) because every additional
// person on an AI-enabled plan is another set of hands using the AI PA —
// more tokens burned, not just another login. One workspace = one
// subscription; multi-org is an Enterprise trait, not a loophole on the
// cheap tier.
export interface PricingPlan {
  id: "starter" | "growth" | "enterprise";
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

export const TRIAL_DAYS = 14;

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$19",
    priceNote: "/month per organization",
    seatsIncluded: 3,
    extraSeatPrice: "$6/seat",
    aiNote: "No AI PA on this plan — upgrade to Growth any time to add it.",
    description: "Quotes, invoices, and the customer portal — everything a solo operator needs to leave spreadsheets behind.",
    features: [
      "Unlimited quotes & invoices",
      "Customer self-service portal",
      "E-signatures & CSV import/export",
      "Inventory tracking (no demand AI)",
      "Staff accounts & role permissions",
      "Industry-specific pipeline & vocabulary",
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
    aiNote: "Extra seats are priced higher than Starter's because every added person uses the AI PA — more usage, not just another login.",
    description: "Everything in Starter, plus the AI PA that chases quiet leads and overdue invoices for you.",
    features: [
      "Everything in Starter",
      "AI PA — plain-language command box",
      "Voice assistant & daily voice briefing",
      "AI follow-ups & abandoned-quote recovery",
      "Inventory demand heatmap",
      "POS, rentals & property modules",
      "Team messaging & org chart",
      "5 AI-enabled staff seats included",
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
    aiNote: "AI usage limits and seat pricing are set per contract based on your team size and expected AI PA usage.",
    description: "Same engine, not a different product — for businesses running multiple locations or organizations under one account.",
    features: [
      "Everything in Growth",
      "Multi-location & multi-organization",
      "Custom AI usage limits per seat",
      "Volume seat pricing",
      "Dedicated onboarding",
      "Priority support & SLA",
    ],
    cardVariant: "kb-card-dark",
    ctaLabel: "Talk to us",
    ctaHref: "/pricing",
  },
];
