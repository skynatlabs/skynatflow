// The event bus.
//
// Cron alone gives you a newsletter; events give you a colleague. A quote
// opened four times is a buying signal at the moment it happens, not at 5am
// the next morning.
//
// Emission is deliberately fire-and-forget: a domain event failing to write
// must never fail the business operation that produced it. Nobody's payment
// should roll back because the agent's inbox was unavailable.
//
// The same events fan out to the tenant's webhook subscribers. One emission
// point, two audiences — the agent and whatever the business has integrated —
// so the two can never end up seeing different things happen.

import { prisma } from "@/lib/db";

export type DomainEventType =
  | "quote.opened_repeatedly"
  | "quote.accepted"
  | "quote.declined"
  | "invoice.overdue"
  | "invoice.paid"
  | "payment.failed"
  | "stock.low"
  | "customer.created"
  | "dispute.raised";

/** Human-readable, used in prompts and in the activity feed. */
export const EVENT_LABELS: Record<DomainEventType, string> = {
  "quote.opened_repeatedly": "A customer keeps reopening a quote without replying",
  "quote.accepted": "A quote was accepted",
  "quote.declined": "A quote was declined",
  "invoice.overdue": "An invoice went overdue",
  "invoice.paid": "An invoice was paid",
  "payment.failed": "A card payment failed",
  "stock.low": "A product dropped below its reorder point",
  "customer.created": "A new customer was added",
  "dispute.raised": "A customer raised a dispute",
};

/**
 * Which events are worth waking the agent for. A paid invoice is good news
 * and needs no intervention; an overdue one does. Keeping this list short is
 * what stops the agent being noise.
 */
const ACTIONABLE: DomainEventType[] = [
  "quote.opened_repeatedly",
  // A customer just said yes. That is work to schedule, stock to reserve and
  // an invoice to raise — the most actionable moment there is, and the one
  // where an owner most often loses a day to admin.
  "quote.accepted",
  "invoice.overdue",
  "payment.failed",
  "stock.low",
  "dispute.raised",
];

export function isActionable(type: string): boolean {
  return (ACTIONABLE as string[]).includes(type);
}

export async function emitEvent(params: {
  tenantId: string;
  type: DomainEventType;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.domainEvent.create({
      data: {
        tenantId: params.tenantId,
        type: params.type,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        // Round-tripped through JSON so Prisma sees a plain Json value
        // rather than an arbitrary Record with non-serialisable members.
        payload: JSON.parse(JSON.stringify(params.payload ?? {})),
        // Non-actionable events are recorded for the activity feed but marked
        // handled immediately, so they never enter the agent's queue.
        processedAt: isActionable(params.type) ? null : new Date(),
      },
    });

    // The same events go out to whoever subscribed. Riding the existing bus
    // rather than emitting separately is what keeps the agent's view of the
    // business and an integrator's view from drifting apart.
    const { queueWebhooks } = await import("@/lib/api/webhooks");
    await queueWebhooks({
      tenantId: params.tenantId,
      event: params.type,
      payload: {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        ...(params.payload ?? {}),
      },
    });
  } catch (err) {
    console.error(`[events] failed to emit ${params.type} for ${params.tenantId}:`, err);
  }
}

/**
 * Claims a batch of unprocessed events for one tenant.
 *
 * Stamping processedAt inside the claim is what makes two overlapping ticks
 * safe: the second one finds nothing left to take, rather than both reacting
 * to the same overdue invoice and sending the customer two chasers.
 */
export async function claimPendingEvents(tenantId: string, limit = 20) {
  const candidates = await prisma.domainEvent.findMany({
    where: { tenantId, processedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const claimed = await prisma.domainEvent.updateMany({
    where: { id: { in: ids }, processedAt: null },
    data: { processedAt: new Date() },
  });
  if (claimed.count === 0) return [];

  return prisma.domainEvent.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "asc" },
  });
}

/** Recent activity for the dashboard feed, actionable or not. */
export async function recentEvents(tenantId: string, take = 12) {
  return prisma.domainEvent.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
