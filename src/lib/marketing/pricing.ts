// Single source of truth for the plans shown at the bottom of every
// marketing page (see chrome.tsx's PricingTeaser) and the full /pricing
// page. Change the numbers here, not per-component.
//
// The structure: every plan includes the AI PA — the credit quota is what
// controls cost, not a feature gate. Each seat gets a character quota of
// AI usage per month; going over it is the lever that protects margin
// instead of cutting AI out of the cheap tier entirely. Extra-seat pricing
// on Growth/Enterprise is deliberately higher than Starter's ($8 vs $6)
// because every additional person is another set of hands using the AI
// PA — more tokens burned, not just another login. One workspace = one
// subscription; multi-org is an Enterprise trait, not a loophole on the
// cheap tier.
export interface PricingPlan {
  id: "starter" | "growth" | "enterprise";
  name: string;
  price: string;
  priceNote: string;
  seatsIncluded: number;
  extraSeatPrice: string | null;
  aiCreditsPerSeat: string;
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
    aiCreditsPerSeat: "20,000 AI characters / seat / month",
    aiNote: "Limited agentic credits — enough for regular follow-ups and quotes. Upgrade to Growth for a bigger quota.",
    description: "Quotes, invoices, the customer portal, and the AI PA — everything a solo operator needs to leave spreadsheets behind.",
    features: [
      "Unlimited quotes & invoices",
      "AI PA — plain-language command box",
      "20,000 AI characters per seat, per month",
      "Customer self-service portal",
      "E-signatures & CSV import/export",
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
    aiCreditsPerSeat: "100,000 AI characters / seat / month",
    aiNote: "5x Starter's AI quota per seat — sized for a team that leans on the AI PA daily. Extra seats cost more than Starter's because each one uses that quota too.",
    description: "Everything in Starter, with a bigger AI quota and the automation that chases quiet leads and overdue invoices for you.",
    features: [
      "Everything in Starter",
      "100,000 AI characters per seat, per month",
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
    aiCreditsPerSeat: "Custom AI quota / seat",
    aiNote: "AI quota and seat pricing are set per contract based on your team size and expected AI PA usage.",
    description: "Same engine, not a different product — for businesses running multiple locations or organizations under one account.",
    features: [
      "Everything in Growth",
      "Multi-location & multi-organization",
      "Custom AI usage quota per seat",
      "Volume seat pricing",
      "Dedicated onboarding",
      "Priority support & SLA",
    ],
    cardVariant: "kb-card-dark",
    ctaLabel: "Talk to us",
    ctaHref: "/pricing",
  },
];
