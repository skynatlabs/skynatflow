// Outbound webhooks: flow telling other systems what happened.
//
// The mirror of the inbound payment webhooks the app already verifies, and
// signed the same way — HMAC-SHA256 over the raw body — so a receiver can
// tell a real event from anyone who guessed the URL.
//
// Fan-out rides on the domain event bus that already exists (lib/agent/events).
// That bus was built so the agent could react to the business changing; an
// external system wanting the same events wants exactly the same list, and
// duplicating the emission points would guarantee the two drift.
//
// Queue-then-send, never send-inline: an endpoint that is slow or down must
// not slow down or fail the business operation that produced the event.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

/** Attempt schedule in minutes. Five tries across roughly two hours. */
const BACKOFF_MINUTES = [0, 1, 5, 20, 90];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** For anyone implementing a receiver — and for our own tests. */
export function verifySignature(params: {
  secret: string;
  body: string;
  timestamp: number;
  signature: string;
}): boolean {
  const expected = signPayload(params.secret, params.body, params.timestamp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(params.signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Queues one event for every endpoint that asked for it.
 *
 * Swallows its own failures on purpose: this is called from inside business
 * operations, and nobody's payment should roll back because a webhook row
 * could not be written.
 */
export async function queueWebhooks(params: {
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId: params.tenantId, isActive: true },
      select: { id: true, events: true },
    });

    // An endpoint with no event list wants everything — the useful default
    // for a first integration, which almost always means "tell me anything".
    const wanted = endpoints.filter(
      (e) => e.events.length === 0 || e.events.includes(params.event)
    );
    if (wanted.length === 0) return 0;

    await prisma.webhookDelivery.createMany({
      data: wanted.map((e) => ({
        endpointId: e.id,
        event: params.event,
        payload: JSON.parse(JSON.stringify(params.payload)),
        status: "PENDING",
        nextAttempt: new Date(),
      })),
    });
    return wanted.length;
  } catch (err) {
    console.error(`[webhooks] queue failed for ${params.event}:`, err);
    return 0;
  }
}

export interface DispatchResult {
  attempted: number;
  delivered: number;
  failed: number;
}

/**
 * Sends whatever is due.
 *
 * Claims each delivery by stamping the attempt before sending, so two
 * overlapping cron runs cannot both post the same event — the same atomic
 * claim the payment webhooks and the agent tick already use.
 */
export async function dispatchDueWebhooks(now = new Date()): Promise<DispatchResult> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttempt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { endpoint: { select: { url: true, secret: true, isActive: true } } },
  });

  const result: DispatchResult = { attempted: 0, delivered: 0, failed: 0 };

  for (const delivery of due) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING" },
      data: { attempts: { increment: 1 }, nextAttempt: null },
    });
    if (claimed.count !== 1) continue;
    if (!delivery.endpoint.isActive) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: "Endpoint is switched off." },
      });
      continue;
    }

    result.attempted += 1;
    const attempt = delivery.attempts + 1;
    const timestamp = Math.floor(now.getTime() / 1000);
    const raw = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });

    try {
      const res = await fetch(delivery.endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Flow-Event": delivery.event,
          "X-Flow-Timestamp": String(timestamp),
          "X-Flow-Signature": signPayload(delivery.endpoint.secret, raw, timestamp),
          "User-Agent": "flow-webhooks/1",
        },
        body: raw,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "DELIVERED", statusCode: res.status, deliveredAt: new Date(), error: null },
        });
        result.delivered += 1;
        continue;
      }

      await reschedule(delivery.id, attempt, res.status, `HTTP ${res.status}`);
      result.failed += 1;
    } catch (err) {
      await reschedule(
        delivery.id,
        attempt,
        null,
        err instanceof Error ? err.message.slice(0, 300) : "Request failed"
      );
      result.failed += 1;
    }
  }

  return result;
}

async function reschedule(id: string, attempt: number, statusCode: number | null, error: string) {
  if (attempt >= MAX_ATTEMPTS) {
    // Given up on, but kept: a delivery that silently disappears is one the
    // receiver will one day insist they never got, with nothing to check.
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: "FAILED", statusCode, error, nextAttempt: null },
    });
    return;
  }

  const wait = BACKOFF_MINUTES[attempt] ?? 90;
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: "PENDING",
      statusCode,
      error,
      nextAttempt: new Date(Date.now() + wait * 60_000),
    },
  });
}

export async function listEndpoints(tenantId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, event: true, status: true, statusCode: true, attempts: true, createdAt: true },
      },
    },
  });
}

export async function createEndpoint(params: {
  tenantId: string;
  url: string;
  events: string[];
}) {
  if (!/^https:\/\//i.test(params.url)) {
    throw new Error("Use an https:// URL — events carry business data.");
  }
  return prisma.webhookEndpoint.create({
    data: {
      tenantId: params.tenantId,
      url: params.url,
      secret: newWebhookSecret(),
      events: params.events,
    },
  });
}

export async function deleteEndpoint(tenantId: string, endpointId: string) {
  const owned = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId },
    select: { id: true },
  });
  if (!owned) throw new Error("Endpoint not found.");
  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
}
