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
import { syncReminderToCalendar, deleteCalendarEvent } from "@/lib/calendar/google";

export async function setManualReminder(params: {
  tenantId: string;
  transactionId: string;
  remindAt: Date;
  note?: string;
}) {
  const tx = await prisma.transaction.findUniqueOrThrow({
    where: { id: params.transactionId },
    include: { party: true },
  });
  if (tx.tenantId !== params.tenantId) throw new Error("Not found.");

  // Live two-way sync: create or update the same calendar event rather
  // than a fresh one each time — a no-op (returns null) if this tenant
  // hasn't connected a calendar, same graceful-degradation posture as
  // every other optional integration here.
  const docType = tx.type === "QUOTE" ? "quote" : "invoice";
  const calendarEventId = await syncReminderToCalendar({
    tenantId: params.tenantId,
    transactionId: params.transactionId,
    summary: `Follow up with ${tx.party.name} — ${docType}`,
    description: params.note || `Follow up on this ${docType}.`,
    startAt: params.remindAt,
  });

  return prisma.transaction.update({
    where: { id: params.transactionId },
    data: {
      nextFollowUpAt: params.remindAt,
      followUpNote: params.note || null,
      calendarEventId: calendarEventId ?? tx.calendarEventId,
    },
  });
}

export async function clearManualReminder(tenantId: string, transactionId: string) {
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (tx.tenantId !== tenantId) throw new Error("Not found.");

  if (tx.calendarEventId) {
    await deleteCalendarEvent(tenantId, tx.calendarEventId);
  }

  return prisma.transaction.update({
    where: { id: transactionId },
    data: { nextFollowUpAt: null, followUpNote: null, calendarEventId: null },
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
