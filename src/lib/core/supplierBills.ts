// What you owe, and when.
//
// The books already record what has been spent. Nothing recorded what has not
// been spent yet but must be — which is the whole of a payables ledger, and
// the reason an owner cannot answer "what does Friday cost" without going
// through a drawer.
//
// The distinction that makes this work: an expense is money that has gone, a
// bill is money that has not. Paying a bill creates the expense. Keeping them
// as one row, which is the tempting shortcut, means either the cash forecast
// counts money twice or the books count it before it left.

import { BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export interface BillInput {
  tenantId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  reference?: string | null;
  issuedOn?: Date;
  dueOn: Date;
  amountCents: number;
  taxCents?: number | null;
  currency?: string | null;
  purchaseOrderId?: string | null;
  notes?: string | null;
}

export async function recordBill(params: BillInput) {
  if (params.amountCents <= 0) throw new Error("A bill has to be for something.");
  if (!params.supplierId && !params.supplierName?.trim()) throw new Error("Who is it from?");

  if (params.supplierId) {
    const supplier = await prisma.party.findFirst({
      where: { id: params.supplierId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!supplier) throw new Error("That supplier is not in this workspace.");
  }
  if (params.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.purchaseOrderId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!po) throw new Error("That purchase order is not in this workspace.");
  }

  return prisma.supplierBill.create({
    data: {
      tenantId: params.tenantId,
      supplierId: params.supplierId ?? null,
      supplierName: params.supplierName?.trim() || null,
      reference: params.reference?.trim() || null,
      issuedOn: params.issuedOn ?? new Date(),
      dueOn: params.dueOn,
      amountCents: params.amountCents,
      taxCents: params.taxCents ?? null,
      currency: params.currency ?? null,
      purchaseOrderId: params.purchaseOrderId ?? null,
      notes: params.notes?.trim() || null,
    },
  });
}

export async function approveBill(tenantId: string, billId: string, approvedById?: string | null) {
  const bill = await prisma.supplierBill.findFirst({ where: { id: billId, tenantId }, select: { id: true, status: true } });
  if (!bill) throw new Error("That bill is not in this workspace.");
  if (bill.status === BillStatus.PAID) throw new Error("That bill has already been paid.");
  return prisma.supplierBill.update({
    where: { id: billId },
    data: { status: BillStatus.APPROVED, approvedById: approvedById ?? null, approvedAt: new Date() },
  });
}

export async function voidBill(tenantId: string, billId: string) {
  const bill = await prisma.supplierBill.findFirst({ where: { id: billId, tenantId }, select: { id: true, status: true } });
  if (!bill) throw new Error("That bill is not in this workspace.");
  if (bill.status === BillStatus.PAID) throw new Error("A paid bill cannot be voided. Record a credit instead.");
  return prisma.supplierBill.update({ where: { id: billId }, data: { status: BillStatus.VOID } });
}

/**
 * Paid — which is the moment it becomes a cost.
 *
 * The expense is written here rather than being left to somebody to remember,
 * because a bill paid and never recorded is money missing from the books with
 * nothing to point at.
 */
export async function payBill(params: {
  tenantId: string;
  billId: string;
  amountCents?: number;
  paidOn?: Date;
  submittedById: string;
}) {
  const bill = await prisma.supplierBill.findFirst({ where: { id: params.billId, tenantId: params.tenantId } });
  if (!bill) throw new Error("That bill is not in this workspace.");
  if (bill.status === BillStatus.VOID) throw new Error("That bill was voided.");

  const amount = params.amountCents ?? bill.amountCents - bill.paidCents;
  if (amount <= 0) throw new Error("There is nothing left to pay on it.");
  const paidCents = Math.min(bill.amountCents, bill.paidCents + amount);
  const settled = paidCents >= bill.amountCents;
  const paidOn = params.paidOn ?? new Date();

  const expense = await prisma.expense.create({
    data: {
      tenantId: params.tenantId,
      submittedById: params.submittedById,
      descriptionText: `${bill.supplierName ?? "Supplier"} · ${bill.reference ?? "bill"}`,
      amountCents: amount,
      taxCents: bill.taxCents,
      supplierId: bill.supplierId,
      supplierName: bill.supplierName,
      reference: bill.reference,
      spentOn: paidOn,
      status: "APPROVED",
      approvedById: bill.approvedById,
    },
  });

  return prisma.supplierBill.update({
    where: { id: bill.id },
    data: {
      paidCents,
      status: settled ? BillStatus.PAID : bill.status,
      paidAt: settled ? paidOn : null,
      expenseId: expense.id,
    },
  });
}

export async function listBills(
  tenantId: string,
  opts: { status?: BillStatus; supplierId?: string; dueBefore?: Date; take?: number } = {}
) {
  return prisma.supplierBill.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
      ...(opts.dueBefore ? { dueOn: { lte: opts.dueBefore } } : {}),
    },
    orderBy: [{ status: "asc" }, { dueOn: "asc" }],
    take: opts.take ?? 200,
    include: { supplier: { select: { id: true, name: true, companyName: true } } },
  });
}

export interface AgeingBucket {
  label: string;
  cents: number;
  count: number;
}

export interface SupplierAgeing {
  supplierId: string | null;
  supplier: string;
  buckets: AgeingBucket[];
  totalCents: number;
  oldestDays: number;
}

const BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: "Not yet due", from: -Infinity, to: 0 },
  { label: "1–30 days", from: 1, to: 30 },
  { label: "31–60 days", from: 31, to: 60 },
  { label: "61–90 days", from: 61, to: 90 },
  { label: "Over 90 days", from: 91, to: Infinity },
];

/**
 * Who is owed what, by how late.
 *
 * The mirror image of the debtors ageing the business already has, and the
 * half that decides whether a supplier keeps delivering.
 */
export async function payablesAgeing(tenantId: string, now = new Date()): Promise<SupplierAgeing[]> {
  const bills = await prisma.supplierBill.findMany({
    where: { tenantId, status: { in: [BillStatus.AWAITING_APPROVAL, BillStatus.APPROVED] } },
    include: { supplier: { select: { id: true, name: true, companyName: true } } },
  });

  const by = new Map<string, SupplierAgeing>();
  for (const bill of bills) {
    const outstanding = bill.amountCents - bill.paidCents;
    if (outstanding <= 0) continue;

    const key = bill.supplierId ?? `name:${bill.supplierName ?? "unknown"}`;
    const name = bill.supplier?.companyName ?? bill.supplier?.name ?? bill.supplierName ?? "Unknown supplier";
    const daysLate = Math.floor((now.getTime() - bill.dueOn.getTime()) / 86_400_000);

    const row =
      by.get(key) ??
      ({
        supplierId: bill.supplierId,
        supplier: name,
        buckets: BUCKETS.map((b) => ({ label: b.label, cents: 0, count: 0 })),
        totalCents: 0,
        oldestDays: 0,
      } satisfies SupplierAgeing);

    const index = BUCKETS.findIndex((b) => daysLate >= b.from && daysLate <= b.to);
    const bucket = row.buckets[index === -1 ? 0 : index];
    bucket.cents += outstanding;
    bucket.count += 1;
    row.totalCents += outstanding;
    row.oldestDays = Math.max(row.oldestDays, daysLate);
    by.set(key, row);
  }

  return [...by.values()].sort((a, b) => b.totalCents - a.totalCents);
}

/** Everything due by a date, as one batch to release together. */
export async function buildPaymentRun(params: { tenantId: string; runOn: Date; dueBefore?: Date; createdById?: string | null }) {
  const bills = await prisma.supplierBill.findMany({
    where: {
      tenantId: params.tenantId,
      status: BillStatus.APPROVED,
      paymentRunId: null,
      dueOn: { lte: params.dueBefore ?? params.runOn },
    },
    select: { id: true, amountCents: true, paidCents: true },
  });
  if (bills.length === 0) throw new Error("Nothing approved is due by then.");

  const total = bills.reduce((s, b) => s + (b.amountCents - b.paidCents), 0);
  const run = await prisma.paymentRun.create({
    data: { tenantId: params.tenantId, runOn: params.runOn, totalCents: total, createdById: params.createdById ?? null },
  });
  await prisma.supplierBill.updateMany({ where: { id: { in: bills.map((b) => b.id) } }, data: { paymentRunId: run.id } });
  return { runId: run.id, bills: bills.length, totalCents: total };
}

/** The money has gone. Every bill in the run becomes a cost. */
export async function releasePaymentRun(params: { tenantId: string; runId: string; submittedById: string; paidOn?: Date }) {
  const run = await prisma.paymentRun.findFirst({
    where: { id: params.runId, tenantId: params.tenantId },
    include: { bills: { select: { id: true } } },
  });
  if (!run) throw new Error("That payment run is not in this workspace.");
  if (run.status === "RELEASED") throw new Error("That run has already gone out.");

  for (const bill of run.bills) {
    await payBill({ tenantId: params.tenantId, billId: bill.id, submittedById: params.submittedById, paidOn: params.paidOn });
  }
  await prisma.paymentRun.update({ where: { id: run.id }, data: { status: "RELEASED", releasedAt: new Date() } });
  return { paid: run.bills.length, totalCents: run.totalCents };
}

/** One line for the brief: what is owed and what of it is late. */
export async function payablesSummary(tenantId: string, now = new Date()) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
  const ageing = await payablesAgeing(tenantId, now);
  const total = ageing.reduce((s, r) => s + r.totalCents, 0);
  const late = ageing.reduce(
    (s, r) => s + r.buckets.filter((b) => b.label !== "Not yet due").reduce((x, b) => x + b.cents, 0),
    0
  );
  return {
    totalCents: total,
    lateCents: late,
    suppliers: ageing.length,
    summary:
      total === 0
        ? "Nothing outstanding to suppliers."
        : `${formatMoney(total, tenant.currency)} owed to ${ageing.length} ${ageing.length === 1 ? "supplier" : "suppliers"}` +
          (late > 0 ? `, of which ${formatMoney(late, tenant.currency)} is past its date.` : ", none of it late."),
    ageing,
  };
}
