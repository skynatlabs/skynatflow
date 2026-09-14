// Outbound webhooks carry business data to third parties, so the signature
// has to be real and the retry behaviour has to be honest: a delivery that
// never lands must end up visibly FAILED, not quietly gone.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  signPayload,
  verifySignature,
  newWebhookSecret,
  queueWebhooks,
  dispatchDueWebhooks,
  createEndpoint,
  deleteEndpoint,
} from "../../src/lib/api/webhooks";

let tenantId: string;
let otherTenantId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Hook Co", niche: "SERVICES" } });
  const o = await prisma.tenant.create({ data: { name: "Hook Other", niche: "RETAIL" } });
  tenantId = t.id;
  otherTenantId = o.id;
});

afterAll(async () => {
  for (const t of [tenantId, otherTenantId]) {
    await prisma.webhookDelivery.deleteMany({ where: { endpoint: { tenantId: t } } });
    await prisma.webhookEndpoint.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }
  vi.restoreAllMocks();
});

describe("signing", () => {
  it("round-trips a signature", () => {
    const secret = newWebhookSecret();
    const body = JSON.stringify({ event: "invoice.paid", amount: 125000 });
    const ts = 1789000000;
    expect(verifySignature({ secret, body, timestamp: ts, signature: signPayload(secret, body, ts) })).toBe(true);
  });

  it("rejects a tampered body, a replayed timestamp and the wrong secret", () => {
    const secret = newWebhookSecret();
    const body = JSON.stringify({ amount: 100 });
    const ts = 1789000000;
    const sig = signPayload(secret, body, ts);

    expect(verifySignature({ secret, body: JSON.stringify({ amount: 999999 }), timestamp: ts, signature: sig })).toBe(false);
    expect(verifySignature({ secret, body, timestamp: ts + 1, signature: sig })).toBe(false);
    expect(verifySignature({ secret: newWebhookSecret(), body, timestamp: ts, signature: sig })).toBe(false);
  });

  it("includes the timestamp in the signed material, so a body can't be replayed later", () => {
    const secret = newWebhookSecret();
    const body = "{}";
    expect(signPayload(secret, body, 1)).not.toBe(signPayload(secret, body, 2));
  });
});

describe("endpoints", () => {
  it("refuses plain http, because events carry business data", async () => {
    await expect(
      createEndpoint({ tenantId, url: "http://example.com/hook", events: [] })
    ).rejects.toThrow(/https/i);
  });

  it("will not let one workspace delete another's endpoint", async () => {
    const theirs = await createEndpoint({
      tenantId: otherTenantId, url: "https://example.com/theirs", events: [],
    });
    await expect(deleteEndpoint(tenantId, theirs.id)).rejects.toThrow(/not found/i);
    expect(await prisma.webhookEndpoint.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

describe("queueing", () => {
  it("queues only for endpoints that asked for the event", async () => {
    const all = await createEndpoint({ tenantId, url: "https://example.com/all", events: [] });
    const narrow = await createEndpoint({
      tenantId, url: "https://example.com/paid-only", events: ["invoice.paid"],
    });

    await queueWebhooks({ tenantId, event: "stock.low", payload: { itemId: "x" } });

    const forAll = await prisma.webhookDelivery.count({ where: { endpointId: all.id } });
    const forNarrow = await prisma.webhookDelivery.count({ where: { endpointId: narrow.id } });

    // An empty event list means "everything" — the useful default for a
    // first integration.
    expect(forAll).toBe(1);
    expect(forNarrow).toBe(0);
  });

  it("never queues across workspaces", async () => {
    await queueWebhooks({ tenantId, event: "invoice.paid", payload: {} });
    const leaked = await prisma.webhookDelivery.count({
      where: { endpoint: { tenantId: otherTenantId }, event: "invoice.paid" },
    });
    expect(leaked).toBe(0);
  });
});

describe("dispatching", () => {
  it("marks a 200 as delivered and signs what it sent", async () => {
    const endpoint = await createEndpoint({
      tenantId, url: "https://example.com/ok", events: ["quote.accepted"],
    });
    await queueWebhooks({ tenantId, event: "quote.accepted", payload: { amountCents: 5000 } });

    // Captured by URL, not by body: the catch-all endpoint created earlier
    // receives this event too, with a different secret, so matching on the
    // payload would verify the wrong delivery's signature.
    const seen: { url: string; body: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({
        url: String(url),
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      });
      return new Response("", { status: 200 });
    });

    const result = await dispatchDueWebhooks();
    expect(result.delivered).toBeGreaterThan(0);

    const sent = seen.find((s) => s.url === endpoint.url);
    expect(sent).toBeDefined();
    expect(
      verifySignature({
        secret: endpoint.secret,
        body: sent!.body,
        timestamp: Number(sent!.headers["X-Flow-Timestamp"]),
        signature: sent!.headers["X-Flow-Signature"],
      })
    ).toBe(true);

    const row = await prisma.webhookDelivery.findFirst({
      where: { endpointId: endpoint.id, event: "quote.accepted" },
    });
    expect(row?.status).toBe("DELIVERED");
    expect(row?.deliveredAt).not.toBeNull();
  });

  it("retries a failure with backoff rather than dropping it", async () => {
    const endpoint = await createEndpoint({
      tenantId, url: "https://example.com/down", events: ["payment.failed"],
    });
    await queueWebhooks({ tenantId, event: "payment.failed", payload: {} });

    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await dispatchDueWebhooks();

    const row = await prisma.webhookDelivery.findFirstOrThrow({
      where: { endpointId: endpoint.id },
    });
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.statusCode).toBe(500);
    // Scheduled for later, not retried in a hot loop.
    expect(row.nextAttempt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives up visibly after the last attempt instead of vanishing", async () => {
    const endpoint = await createEndpoint({
      tenantId, url: "https://example.com/dead", events: ["dispute.raised"],
    });
    await queueWebhooks({ tenantId, event: "dispute.raised", payload: {} });

    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));

    // Five scheduled attempts; drag each one forward rather than waiting.
    for (let i = 0; i < 5; i++) {
      await prisma.webhookDelivery.updateMany({
        where: { endpointId: endpoint.id, status: "PENDING" },
        data: { nextAttempt: new Date(Date.now() - 1000) },
      });
      await dispatchDueWebhooks();
    }

    const row = await prisma.webhookDelivery.findFirstOrThrow({
      where: { endpointId: endpoint.id },
    });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(5);
    // Still there to be looked at — "we sent it" is a claim someone checks.
    expect(row.error).toBeTruthy();
  });

  it("does not send to an endpoint that has been switched off", async () => {
    const endpoint = await createEndpoint({
      tenantId, url: "https://example.com/paused", events: ["customer.created"],
    });
    await queueWebhooks({ tenantId, event: "customer.created", payload: {} });
    await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { isActive: false } });

    // Again scoped by URL — other endpoints legitimately receive this event.
    const hit: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hit.push(String(url));
      return new Response("", { status: 200 });
    });
    await dispatchDueWebhooks();

    expect(hit).not.toContain(endpoint.url);
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } });
    expect(row.status).toBe("FAILED");
  });
});
