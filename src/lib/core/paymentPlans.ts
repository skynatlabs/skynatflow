// Paying it off.
//
// Every small business already does this — "half now, half end of month" —
// and records it nowhere. So the overdue list says the whole amount has been
// late since the day after the invoice date, the chaser goes out to somebody
// who is paying exactly as agreed, and the arrears figure the owner plans
// around is wrong in the direction that causes the most damage.
//
// A plan fixes one thing precisely: what "overdue" means on this invoice. Only
// instalments whose day has passed and which are not yet covered by payments
// count as late. Everything else about the invoice is unchanged — the total,
// the ledger, the document. A plan is an agreement about timing, not a
// different kind of invoice.

import { prisma } from "@/lib/db";
import { netPaidByInvoice } from "./money";

export interface InstalmentInput {
  dueOn: Date;
  amountCents: number;
}

export interface InstalmentView {
  id: string;
  dueOn: Date;
  amountCents: number;
  /** How much of this instalment the payments received cover. */
  coveredCents: number;
  outstandingCents: number;
  /** Past its day and not covered. */
  overdue: boolean;
}

export interface PlanView {
  id: string;
  transactionId: string;
  depositCents: number;
  note: string | null;
  cancelledAt: Date | null;
  instalments: InstalmentView[];
  /** The amount genuinely late today — the whole point of the model. */
  overdueCents: number;
  /** What is still to come, on days that have not arrived. */
  notYetDueCents: number;
  paidCents: number;
  /** The next instalment that has not been covered, if there is one. */
  nextDue: { dueOn: Date; amountCents: number } | null;
}

/** Instalments in one line: "3 × R1 500, monthly from 1 October". */
export function evenInstalments(params: {
  totalCents: number;
  count: number;
  firstDueOn: Date;
  /** weekly | fortnightly | monthly */
  every?: "weekly" | "fortnightly" | "monthly";
}): InstalmentInput[] {
  if (params.count < 1) throw new Error("A plan needs at least one instalment.");
  if (params.totalCents <= 0) throw new Error("There is nothing to spread.");

  // The rounding remainder goes on the first instalment, not the last: a
  // business would rather be a cent up front than a cent short at the end.
  const each = Math.floor(params.totalCents / params.count);
  const remainder = params.totalCents - each * params.count;

  return Array.from({ length: params.count }, (_, i) => {
    const dueOn = new Date(params.firstDueOn);
    if (params.every === "weekly") dueOn.setDate(dueOn.getDate() + i * 7);
    else if (params.every === "fortnightly") dueOn.setDate(dueOn.getDate() + i * 14);
    else dueOn.setMonth(dueOn.getMonth() + i);
    return { dueOn, amountCents: each + (i === 0 ? remainder : 0) };
  });
}

export async function createPaymentPlan(params: {
  tenantId: string;
  transactionId: string;
  depositCents?: number;
  instalments: InstalmentInput[];
  note?: string | null;
  agreedById?: string | null;
}) {
  const invoice = await prisma.transaction.findFirst({
    where: { id: params.transactionId, tenantId: params.tenantId, type: "INVOICE" },
    select: { id: true, amountCents: true, status: true },
  });
  if (!invoice) throw new Error("That invoice is not in this workspace.");
  if (invoice.status === "CANCELLED") throw new Error("That invoice was cancelled.");
  if (params.instalments.length === 0) throw new Error("A plan needs at least one instalment.");

  const deposit = Math.max(0, params.depositCents ?? 0);
  const scheduled = params.instalments.reduce((s, i) => s + i.amountCents, 0);
  // A plan that adds up to something other than the invoice is the single
  // most common way one of these goes wrong, and it goes wrong silently.
  if (deposit + scheduled !== invoice.amountCents) {
    throw new Error(
      `The plan comes to ${(deposit + scheduled) / 100} but the invoice is ${invoice.amountCents / 100}. They have to match.`
    );
  }

  return prisma.paymentPlan.upsert({
    where: { transactionId: invoice.id },
    create: {
      tenantId: params.tenantId,
      transactionId: invoice.id,
      depositCents: deposit,
      note: params.note?.trim() || null,
      agreedById: params.agreedById ?? null,
      instalments: {
        create: params.instalments.map((i, sortOrder) => ({ dueOn: i.dueOn, amountCents: i.amountCents, sortOrder })),
      },
    },
    update: {
      depositCents: deposit,
      note: params.note?.trim() || null,
      cancelledAt: null,
      instalments: {
        deleteMany: {},
        create: params.instalments.map((i, sortOrder) => ({ dueOn: i.dueOn, amountCents: i.amountCents, sortOrder })),
      },
    },
    include: { instalments: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function cancelPaymentPlan(tenantId: string, transactionId: string) {
  const plan = await prisma.paymentPlan.findFirst({ where: { transactionId, tenantId }, select: { id: true } });
  if (!plan) throw new Error("There is no plan on that invoice.");
  return prisma.paymentPlan.update({ where: { id: plan.id }, data: { cancelledAt: new Date() } });
}

/**
 * The plan, read against what has actually been paid.
 *
 * Payments are applied to instalments oldest first, which is how everybody
 * treats them and the only order that makes "which instalment is late"
 * answerable. The deposit is settled before the first instalment.
 */
export async function paymentPlanFor(tenantId: string, transactionId: string, now = new Date()): Promise<PlanView | null> {
  const plan = await prisma.paymentPlan.findFirst({
    where: { transactionId, tenantId },
    include: { instalments: { orderBy: [{ dueOn: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!plan || plan.cancelledAt) return null;

  const paid = (await netPaidByInvoice([transactionId])).get(transactionId) ?? 0;
  let left = Math.max(0, paid - plan.depositCents);

  let overdueCents = 0;
  let notYetDueCents = 0;
  let nextDue: PlanView["nextDue"] = null;

  const instalments: InstalmentView[] = plan.instalments.map((i) => {
    const covered = Math.min(i.amountCents, left);
    left -= covered;
    const outstanding = i.amountCents - covered;
    const overdue = outstanding > 0 && i.dueOn <= now;
    if (overdue) overdueCents += outstanding;
    else if (outstanding > 0) notYetDueCents += outstanding;
    if (outstanding > 0 && !nextDue) nextDue = { dueOn: i.dueOn, amountCents: outstanding };
    return { id: i.id, dueOn: i.dueOn, amountCents: i.amountCents, coveredCents: covered, outstandingCents: outstanding, overdue };
  });

  // The deposit is due immediately, so a shortfall against it is late today.
  const depositShort = Math.max(0, plan.depositCents - paid);
  overdueCents += depositShort;

  return {
    id: plan.id,
    transactionId,
    depositCents: plan.depositCents,
    note: plan.note,
    cancelledAt: plan.cancelledAt,
    instalments,
    overdueCents,
    notYetDueCents,
    paidCents: paid,
    nextDue,
  };
}

/**
 * Invoices with a live plan, and what is genuinely late on each.
 *
 * Read by the collections ladder and the overdue list so neither chases
 * somebody who is paying exactly as agreed.
 */
export async function plannedArrears(tenantId: string, now = new Date()) {
  const plans = await prisma.paymentPlan.findMany({
    where: { tenantId, cancelledAt: null },
    select: { transactionId: true },
  });
  const out = new Map<string, { overdueCents: number; nextDue: Date | null }>();
  for (const { transactionId } of plans) {
    const view = await paymentPlanFor(tenantId, transactionId, now);
    if (view) out.set(transactionId, { overdueCents: view.overdueCents, nextDue: view.nextDue?.dueOn ?? null });
  }
  return out;
}
