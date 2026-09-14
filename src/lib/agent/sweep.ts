// Events nobody emits.
//
// Most domain events have an obvious emission point: someone accepted a
// quote, someone opened a portal link. But two of the most important things
// an owner needs to know about aren't caused by anyone — they're states the
// data drifts into. An invoice becomes overdue because a date passed. Stock
// goes low because of a sale recorded hours earlier.
//
// This sweep turns those into real events so the agent reacts to them the
// same way it reacts to everything else, rather than needing a separate
// special case in the tick.
//
// Emitting at most once per subject is what makes it safe to run often: the
// dedupe check is against existing unresolved events for the same subject,
// so an invoice that stays overdue for a month produces one event, not thirty.

import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/agent/events";

export interface SweepResult {
  overdueInvoices: number;
  lowStockItems: number;
}

export async function sweepDerivedEvents(now = new Date()): Promise<SweepResult> {
  const [overdueInvoices, lowStockItems] = await Promise.all([
    sweepOverdueInvoices(now),
    sweepLowStock(),
  ]);
  return { overdueInvoices, lowStockItems };
}

async function sweepOverdueInvoices(now: Date): Promise<number> {
  const candidates = await prisma.transaction.findMany({
    where: {
      type: "INVOICE",
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueAt: { lt: now },
    },
    select: { id: true, tenantId: true, amountCents: true, dueAt: true },
    take: 500,
  });
  if (candidates.length === 0) return 0;

  const alreadyFlagged = await prisma.domainEvent.findMany({
    where: {
      type: "invoice.overdue",
      subjectId: { in: candidates.map((c) => c.id) },
    },
    select: { subjectId: true },
  });
  const seen = new Set(alreadyFlagged.map((e) => e.subjectId));

  let emitted = 0;
  for (const invoice of candidates) {
    if (seen.has(invoice.id)) continue;
    // Move the row itself to OVERDUE so the dashboard agrees with the event.
    await prisma.transaction.updateMany({
      where: { id: invoice.id, status: { in: ["SENT", "PARTIALLY_PAID"] } },
      data: { status: "OVERDUE" },
    });
    await emitEvent({
      tenantId: invoice.tenantId,
      type: "invoice.overdue",
      subjectType: "Transaction",
      subjectId: invoice.id,
      payload: {
        amountCents: invoice.amountCents,
        daysOverdue: invoice.dueAt
          ? Math.floor((now.getTime() - invoice.dueAt.getTime()) / 86_400_000)
          : null,
      },
    });
    emitted++;
  }
  return emitted;
}

async function sweepLowStock(): Promise<number> {
  const candidates = await prisma.item.findMany({
    where: {
      isActive: true,
      stockQty: { not: null },
      reorderPoint: { not: null },
    },
    select: { id: true, tenantId: true, name: true, stockQty: true, reorderPoint: true },
    take: 500,
  });

  const low = candidates.filter(
    (i) => i.stockQty !== null && i.reorderPoint !== null && i.stockQty <= i.reorderPoint
  );
  if (low.length === 0) return 0;

  // Re-alerting on the same item every tick is how a useful signal becomes
  // something people mute, so only flag items with no open flag already.
  const openFlags = await prisma.domainEvent.findMany({
    where: {
      type: "stock.low",
      subjectId: { in: low.map((i) => i.id) },
      processedAt: null,
    },
    select: { subjectId: true },
  });
  const seen = new Set(openFlags.map((e) => e.subjectId));

  let emitted = 0;
  for (const item of low) {
    if (seen.has(item.id)) continue;
    await emitEvent({
      tenantId: item.tenantId,
      type: "stock.low",
      subjectType: "Item",
      subjectId: item.id,
      payload: { name: item.name, stockQty: item.stockQty, reorderPoint: item.reorderPoint },
    });
    emitted++;
  }
  return emitted;
}
