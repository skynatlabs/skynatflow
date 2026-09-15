// How ready this workspace is to actually run the business on.
//
// Not a to-do list. Every step here is checked against real rows, so it ticks
// itself off as a normal day's work happens — nobody is asked to go and
// "complete onboarding". A list that has to be worked through is one people
// abandon; a list that fills in behind them is one they finish without
// noticing.
//
// The order is dependency, then leverage. You cannot send a quote without a
// customer, and a business that has taken one real payment through flow is a
// business that has crossed the line into using it.

import { prisma } from "@/lib/db";

export interface ReadinessStep {
  key: string;
  label: string;
  /** Why this matters, in the owner's terms — not "configure X". */
  why: string;
  done: boolean;
  href: string;
  /** The handful that decide whether flow is actually in use. */
  weight: "core" | "useful";
}

export interface Readiness {
  steps: ReadinessStep[];
  doneCount: number;
  total: number;
  percent: number;
  /** Core steps outstanding — what the nudge should actually point at. */
  nextStep: ReadinessStep | null;
  /** True once every core step is done; the checklist retires itself. */
  operational: boolean;
}

export async function getReadiness(tenantId: string): Promise<Readiness> {
  const base = `/dashboard/${tenantId}`;

  const [
    tenant,
    customerCount,
    productCount,
    sentQuoteCount,
    paidCount,
    gatewayCount,
    memberCount,
    templateWithLogo,
    agentRunCount,
  ] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        businessAddress: true,
        vatNumber: true,
        bankAccountNumber: true,
        agentProactiveEnabled: true,
      },
    }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.item.count({ where: { tenantId, isActive: true } }),
    prisma.transaction.count({
      where: { tenantId, type: "QUOTE", status: { not: "DRAFT" } },
    }),
    prisma.transaction.count({ where: { tenantId, type: "PAYMENT" } }),
    prisma.paymentGateway.count({ where: { tenantId, secretKey: { not: null } } }),
    prisma.membership.count({ where: { tenantId } }),
    prisma.tenantPdfTemplate.count({ where: { tenantId, logoDataUrl: { not: null } } }),
    prisma.agentRun.count({ where: { tenantId } }),
  ]);

  const steps: ReadinessStep[] = [
    {
      key: "customer",
      label: "Add your first customer",
      why: "Everything else hangs off a customer — quotes, invoices, history.",
      done: customerCount > 0,
      href: `${base}/customers`,
      weight: "core",
    },
    {
      key: "product",
      label: "Add what you sell",
      why: "So a quote is three clicks instead of retyping prices every time.",
      done: productCount > 0,
      href: `${base}/products/new`,
      weight: "core",
    },
    {
      key: "businessDetails",
      label: "Your business details",
      why: "A valid tax invoice needs your address and VAT number on it.",
      done: Boolean(tenant.businessAddress),
      href: `${base}/settings/pdf-templates`,
      weight: "core",
    },
    {
      key: "logo",
      label: "Put your logo on documents",
      why: "The first thing a customer sees is whether this looks like a real business.",
      done: templateWithLogo > 0,
      href: `${base}/settings/pdf-templates`,
      weight: "useful",
    },
    {
      key: "quote",
      label: "Send a quote",
      why: "The moment flow starts doing work rather than storing it.",
      done: sentQuoteCount > 0,
      href: `${base}/quotes/new`,
      weight: "core",
    },
    {
      key: "banking",
      label: "Add your banking details",
      why: "So an invoice tells the customer where to pay without you typing it.",
      done: Boolean(tenant.bankAccountNumber),
      href: `${base}/settings/banking`,
      weight: "core",
    },
    {
      key: "gateway",
      label: "Let customers pay by card",
      why: "Invoices with a pay button settle faster than invoices with a bank number.",
      done: gatewayCount > 0,
      href: `${base}/settings/payment-gateways`,
      weight: "useful",
    },
    {
      key: "payment",
      label: "Record your first payment",
      why: "Once money has moved through flow, the numbers everywhere become real.",
      done: paidCount > 0,
      href: `${base}/invoices`,
      weight: "core",
    },
    {
      key: "agent",
      label: "Let the agent watch the business",
      why: "It finds what's overdue and gone quiet while you're doing something else.",
      done: tenant.agentProactiveEnabled && agentRunCount > 0,
      href: `${base}/agent`,
      weight: "useful",
    },
    {
      key: "team",
      label: "Invite someone",
      why: "A business running on one login isn't running on flow yet.",
      done: memberCount > 1,
      href: `${base}/staff`,
      weight: "useful",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const core = steps.filter((s) => s.weight === "core");
  const nextStep = steps.find((s) => !s.done && s.weight === "core") ?? steps.find((s) => !s.done) ?? null;

  return {
    steps,
    doneCount,
    total: steps.length,
    percent: Math.round((doneCount / steps.length) * 100),
    nextStep,
    // Retires on the core steps, not on all ten: a business that is invoicing
    // and getting paid is operational whether or not it invited a teammate,
    // and nagging past that point is how a checklist becomes furniture.
    operational: core.every((s) => s.done),
  };
}


/**
 * Pages with nothing in them for this workspace — no rows, and nothing the
 * trade needs — so the rail can fold them under "More" instead of showing
 * other people's features. Show only what applies; hide nothing for good.
 */
export async function quietPages(tenantId: string): Promise<Set<string>> {
  const [goals, disputes, trips, assetsKm, stock, pos, rentals, properties, connections, attendance, managers, perf] = await Promise.all([
    prisma.goal.count({ where: { tenantId } }),
    prisma.dispute.count({ where: { tenantId } }),
    prisma.trip.count({ where: { tenantId } }),
    prisma.asset.count({ where: { tenantId, capacityUnit: "KM" } }),
    prisma.item.count({ where: { tenantId, stockQty: { not: null } } }),
    prisma.tillSession.count({ where: { tenantId } }),
    prisma.rental.count({ where: { tenantId } }),
    prisma.property.count({ where: { tenantId } }),
    prisma.wholesaleConnection.count({ where: { OR: [{ supplierTenantId: tenantId }, { buyerTenantId: tenantId }] } }),
    prisma.timeEntry.count({ where: { tenantId } }),
    prisma.membership.count({ where: { tenantId, managerId: { not: null } } }),
    prisma.membership.count({ where: { tenantId } }),
  ]);
  const quiet = new Set<string>();
  if (goals === 0) quiet.add("goals");
  if (disputes === 0) quiet.add("disputes");
  if (trips === 0) quiet.add("trips");
  if (assetsKm === 0 && trips === 0) quiet.add("fleet");
  if (stock === 0) quiet.add("inventory");
  if (pos === 0) { quiet.add("pos"); quiet.add("cash-sale"); }
  if (rentals === 0) quiet.add("rentals");
  if (properties === 0) quiet.add("properties");
  if (connections === 0) quiet.add("connections");
  if (attendance === 0) quiet.add("attendance");
  if (managers === 0) quiet.add("org");
  if (perf < 3) quiet.add("team-performance");
  return quiet;
}
