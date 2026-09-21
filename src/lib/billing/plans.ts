// What we charge, in one place.
//
// This is the single source of truth for plans, and it is deliberately code
// rather than database rows: a price is product configuration, it changes
// with a deploy, and it needs to be reviewable in a diff. Rows in a table
// that nobody can see the history of is how two customers end up on prices
// neither of them was quoted.
//
// The marketing site reads this too (src/lib/marketing/pricing.ts), so the
// page cannot advertise a plan the billing engine does not know about. There
// is a drift test asserting exactly that.
//
// THE SHAPE, AND WHY
//
// A seat price alone cannot survive an agent: two seats on the same plan can
// differ tenfold in what they cost us to run. A pure usage price cannot be
// sold to a small business: nobody signs up for a bill they cannot predict.
// So every plan is a seat price that includes a generous, visible allowance
// of agent work, and the meter only bites above it.
//
// Seats are never rounded into blocks. Buying ten seats for a team of six is
// the single most quoted grievance in this category and it costs nothing to
// avoid.

export type PlanKey = "solo" | "pro" | "business" | "enterprise";

/**
 * What a person occupies.
 *
 * A driver clocking onto a job and photographing a delivery should not cost
 * the same as somebody running the books, and a customer reading their own
 * invoice should not cost anything at all. Nobody else in this category
 * prices this honestly, and it is most of why a field business finds the
 * others expensive.
 */
export type SeatClass = "full" | "field" | "portal";

export const SEAT_CLASS_LABELS: Record<SeatClass, string> = {
  full: "Full seat",
  field: "Field seat",
  portal: "Portal",
};

export interface Plan {
  key: PlanKey;
  name: string;
  /** One line, in the words of somebody deciding. */
  summary: string;
  /** Fixed monthly charge for the workspace itself, in cents. */
  baseCents: number;
  /** Seats the base charge already covers. */
  seatsIncluded: number;
  /** Per full seat beyond those included, in cents. */
  fullSeatCents: number;
  /** Per field seat, in cents. Portal seats are always free. */
  fieldSeatCents: number;
  /**
   * Agent work included per full seat per month, in US cents of model spend.
   *
   * Denominated in real cost rather than in "credits" because that is the
   * number that protects the margin, and because a credit is a unit nobody
   * can reason about. What a workspace SEES is a percentage and a plain
   * sentence; this is what that percentage is computed against.
   */
  agentAllowanceCentsPerSeat: number;
  /** Ordered, for the pricing page. */
  features: string[];
  /** Enterprise is quoted, not self-served. */
  quoted?: boolean;
}

export const TRIAL_DAYS = 14;

/**
 * The agent allowance, sized against what a seat actually costs.
 *
 * A fast-tier seat doing ten runs a day costs us roughly $2.80 a month at
 * present rates (measured, not estimated — see the tool-selection work). The
 * allowances below are set well above that, because an allowance that a
 * normal working month can reach is a support ticket rather than a control.
 * What it stops is the genuinely unusual: a loop, a bulk import being
 * re-summarised nightly, one workspace using more agent than forty others.
 */
export const PLANS: Plan[] = [
  {
    key: "solo",
    name: "Solo",
    summary: "One person, or one person and a hand or two.",
    baseCents: 2_900,
    seatsIncluded: 3,
    fullSeatCents: 1_400,
    fieldSeatCents: 500,
    agentAllowanceCentsPerSeat: 600,
    features: [
      "Quotes, invoices, and the customer portal",
      "The full ledger — VAT, bank feeds, cash forecast",
      "The AI assistant, with a monthly allowance",
      "3 seats included, then $14 each",
      "Unlimited free portal seats",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    summary: "A team that runs the business in here every day.",
    baseCents: 0,
    seatsIncluded: 0,
    fullSeatCents: 1_900,
    fieldSeatCents: 700,
    agentAllowanceCentsPerSeat: 1_500,
    features: [
      "Everything in Solo",
      "No base charge — pay for exactly the seats you use",
      "Named agents on a schedule, and the overnight sweeps",
      "Field seats at $7 for drivers and technicians",
      "Public API, webhooks, and the MCP server",
    ],
  },
  {
    key: "business",
    name: "Business",
    summary: "Several locations, or a team that leans on the agent hard.",
    baseCents: 0,
    seatsIncluded: 0,
    fullSeatCents: 3_400,
    fieldSeatCents: 700,
    agentAllowanceCentsPerSeat: 5_000,
    features: [
      "Everything in Pro",
      "Branches, consolidated reporting, multi-currency",
      "More than three times the agent allowance per seat",
      "Priority support",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    summary: "Volume seats, your own security review, a contract.",
    baseCents: 0,
    seatsIncluded: 0,
    fullSeatCents: 2_800,
    fieldSeatCents: 700,
    agentAllowanceCentsPerSeat: 5_000,
    quoted: true,
    features: [
      "Everything in Business",
      "Volume seat pricing from $28",
      "Single sign-on and directory sync",
      "Annual terms, purchase orders, invoicing",
      "Agent allowance pooled across the workspace, not rationed per seat",
    ],
  },
];

export const PLAN_BY_KEY: Record<PlanKey, Plan> = Object.fromEntries(
  PLANS.map((plan) => [plan.key, plan])
) as Record<PlanKey, Plan>;

export function planFor(key: string | null | undefined): Plan {
  return PLAN_BY_KEY[(key ?? "") as PlanKey] ?? PLAN_BY_KEY.pro;
}

export interface SeatCounts {
  full: number;
  field: number;
  portal: number;
}

/**
 * What a workspace owes this month, given who is in it.
 *
 * Seats are counted, never rounded. A team of six is billed for six.
 */
export function monthlyCents(plan: Plan, seats: SeatCounts): number {
  const chargeableFull = Math.max(0, seats.full - plan.seatsIncluded);
  return plan.baseCents + chargeableFull * plan.fullSeatCents + seats.field * plan.fieldSeatCents;
}

/** The agent spend this workspace's plan includes, across all its full seats. */
export function allowanceCents(plan: Plan, seats: SeatCounts): number {
  // Counted on full seats only: a field seat has no agent, and a portal seat
  // is somebody else's customer.
  const billableSeats = Math.max(seats.full, plan.seatsIncluded > 0 ? 1 : 0);
  return billableSeats * plan.agentAllowanceCentsPerSeat;
}
