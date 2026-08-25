// Overdue-invoice tracking + late fees — the direct answer to the
// research's #1 corporate/professional-services leak: 59% of SMEs have
// invoices overdue 30+ days. Nothing here is a new AI/automation layer,
// just surfacing what Transaction.dueAt already implies and letting the
// owner apply a fee with one click instead of negotiating it by hand.

import { TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createQuote } from "./money";

export interface OverdueInvoice {
  id: string;
  partyId: string;
  partyName: string;
  amountCents: number;
  dueAt: Date;
  daysOverdue: number;
}

export async function getOverdueInvoices(tenantId: string): Promise<OverdueInvoice[]> {
  const now = new Date();
  const invoices = await prisma.transaction.findMany({
    where: {
      tenantId,
      type: TransactionType.INVOICE,
      status: { in: [TransactionStatus.SENT, TransactionStatus.PARTIALLY_PAID] },
      dueAt: { lt: now },
    },
    include: { party: true },
    orderBy: { dueAt: "asc" },
  });

  return invoices.map((inv) => ({
    id: inv.id,
    partyId: inv.partyId,
    partyName: inv.party.name,
    amountCents: inv.amountCents,
    dueAt: inv.dueAt!,
    daysOverdue: Math.floor((now.getTime() - inv.dueAt!.getTime()) / 86400000),
  }));
}

// A late fee is its own INVOICE row parented to the original — keeps the
// ledger append-only (never mutates the original invoice's amount) and
// still shows up in the customer's normal balance/portal view.
export async function applyLateFee(params: {
  invoiceId: string;
  feePercent: number;
}) {
  const invoice = await prisma.transaction.findUniqueOrThrow({
    where: { id: params.invoiceId },
  });
  if (invoice.type !== TransactionType.INVOICE) {
    throw new Error("Late fees can only be applied to an INVOICE");
  }

  const feeCents = Math.round((invoice.amountCents * params.feePercent) / 100);
  const feeItem = await prisma.item.create({
    data: {
      tenantId: invoice.tenantId,
      name: `Late fee (${params.feePercent}%) — invoice ${invoice.id.slice(-6)}`,
      unitPriceCents: feeCents,
      isActive: false, // one-off charge, not a reusable catalog entry
    },
  });

  const feeQuote = await createQuote({
    tenantId: invoice.tenantId,
    partyId: invoice.partyId,
    lines: [{ itemId: feeItem.id, quantity: 1, unitPriceCents: feeCents }],
  });

  return prisma.transaction.update({
    where: { id: feeQuote.id },
    data: {
      type: TransactionType.INVOICE,
      status: TransactionStatus.SENT,
      parentId: invoice.id,
      dueAt: new Date(),
    },
  });
}
