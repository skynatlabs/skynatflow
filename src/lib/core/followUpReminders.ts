// Manual follow-up reminders on a quote/invoice — "the customer said
// they'll be ready in 2 months" becomes a real date + note, not a mental
// note. Reuses Transaction.nextFollowUpAt, which findStaleTransactions
// (src/lib/core/money.ts) already treats as an override on the default
// follow-up cadence — setting a future date here genuinely delays the
// automatic follow-up until then, it isn't just a label.
//
// Distinct from src/lib/core/reminders.ts, which is about scheduled
// appointment (booking Event) reminders — this is about quotes/invoices.

import { prisma } from "@/lib/db";
import { TransactionType } from "@prisma/client";

export async function setManualReminder(params: {
  tenantId: string;
  transactionId: string;
  remindAt: Date;
  note?: string;
}) {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: params.transactionId } });
  if (tx.tenantId !== params.tenantId) throw new Error("Not found.");

  return prisma.transaction.update({
    where: { id: params.transactionId },
    data: { nextFollowUpAt: params.remindAt, followUpNote: params.note || null },
  });
}

export async function clearManualReminder(tenantId: string, transactionId: string) {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (tx.tenantId !== tenantId) throw new Error("Not found.");

  return prisma.transaction.update({
    where: { id: transactionId },
    data: { nextFollowUpAt: null, followUpNote: null },
  });
}

// The "This Week" board: every quote/invoice whose next follow-up (manual
// reminder or the default cadence's computed next touch) falls between
// now and 7 days out, plus anything already overdue — the actual "who do
// I need to contact" work list for the week, not just today.
export async function listThisWeekFollowUps(tenantId: string) {
  const weekOut = new Date();
  weekOut.setDate(weekOut.getDate() + 7);

  return prisma.transaction.findMany({
    where: {
      tenantId,
      type: { in: [TransactionType.QUOTE, TransactionType.INVOICE] },
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      nextFollowUpAt: { not: null, lte: weekOut },
    },
    include: { party: true },
    orderBy: { nextFollowUpAt: "asc" },
  });
}
