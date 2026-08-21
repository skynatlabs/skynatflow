// Recurring invoices — a standing instruction, cron-driven. Line items are
// snapshotted at creation time (not live catalog refs) so a later price
// change to the product catalog doesn't silently reprice an existing
// subscription out from under a customer.

import { RecurrenceFrequency, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface RecurringLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

function computeNextRun(from: Date, frequency: RecurrenceFrequency): Date {
  const next = new Date(from);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7);
  else if (frequency === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else next.setMonth(next.getMonth() + 3); // QUARTERLY
  return next;
}

export async function createRecurringInvoice(params: {
  tenantId: string;
  partyId: string;
  frequency: RecurrenceFrequency;
  lines: RecurringLine[];
  dueInDays?: number;
  startAt?: Date;
}) {
  const startAt = params.startAt ?? new Date();
  return prisma.recurringInvoice.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      frequency: params.frequency,
      dueInDays: params.dueInDays ?? 14,
      lines: params.lines as unknown as object,
      nextRunAt: startAt,
    },
  });
}

export async function setRecurringInvoiceActive(id: string, isActive: boolean) {
  return prisma.recurringInvoice.update({ where: { id }, data: { isActive } });
}

export async function listRecurringInvoices(tenantId: string) {
  return prisma.recurringInvoice.findMany({
    where: { tenantId },
    include: { party: true },
    orderBy: { nextRunAt: "asc" },
  });
}

// Called by the cron route — finds every active template due to run,
// creates the invoice, and advances nextRunAt. Idempotent per call in the
// sense that a template only fires once its nextRunAt has actually passed.
export async function runDueRecurringInvoices(): Promise<{ generated: number }> {
  const due = await prisma.recurringInvoice.findMany({
    where: { isActive: true, nextRunAt: { lte: new Date() } },
  });

  let generated = 0;
  for (const template of due) {
    const lines = template.lines as unknown as RecurringLine[];
    const amountCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + template.dueInDays);

    await prisma.transaction.create({
      data: {
        tenantId: template.tenantId,
        partyId: template.partyId,
        type: TransactionType.INVOICE,
        status: TransactionStatus.SENT,
        amountCents,
        dueAt,
        itemLines: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          })),
        },
      },
    });

    await prisma.recurringInvoice.update({
      where: { id: template.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: computeNextRun(template.nextRunAt, template.frequency),
      },
    });
    generated++;
  }

  return { generated };
}
