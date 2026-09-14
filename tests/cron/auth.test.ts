// The bug these lock down: the old per-route guard read
//   if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET)
// which is fail-OPEN. CRON_SECRET was set in neither .env nor .env.example,
// so in production every scheduled job — all of which send WhatsApp/email
// on behalf of every tenant — was callable by anyone with the URL.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { authorizeCron } from "../../src/lib/cron/auth";

const SECRET = "s3cr3t-value-for-tests";
const ORIGINAL = process.env.CRON_SECRET;

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new Request(url, { headers }));
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("authorizeCron", () => {
  it("fails closed when no secret is configured at all", async () => {
    delete process.env.CRON_SECRET;
    const result = authorizeCron(req("https://x.test/api/cron/follow-ups"), "follow-ups");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("still fails closed when a caller supplies a secret but none is configured", async () => {
    delete process.env.CRON_SECRET;
    const result = authorizeCron(
      req("https://x.test/api/cron/follow-ups?secret=anything"),
      "follow-ups"
    );
    expect(result.ok).toBe(false);
  });

  it("accepts the configured secret as a query param", () => {
    const result = authorizeCron(
      req(`https://x.test/api/cron/follow-ups?secret=${encodeURIComponent(SECRET)}`),
      "follow-ups"
    );
    expect(result.ok).toBe(true);
  });

  it("accepts the configured secret as a header", () => {
    const result = authorizeCron(
      req("https://x.test/api/cron/follow-ups", { "x-cron-secret": SECRET }),
      "follow-ups"
    );
    expect(result.ok).toBe(true);
  });

  it("accepts Vercel Cron's bearer header", () => {
    const result = authorizeCron(
      req("https://x.test/api/cron/follow-ups", { authorization: `Bearer ${SECRET}` }),
      "follow-ups"
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a missing secret", () => {
    const result = authorizeCron(req("https://x.test/api/cron/follow-ups"), "follow-ups");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a wrong secret", () => {
    const result = authorizeCron(
      req("https://x.test/api/cron/follow-ups?secret=not-the-secret"),
      "follow-ups"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a correct prefix that is too short", () => {
    const result = authorizeCron(
      req(`https://x.test/api/cron/follow-ups?secret=${SECRET.slice(0, 8)}`),
      "follow-ups"
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a bearer header carrying the wrong secret", () => {
    const result = authorizeCron(
      req("https://x.test/api/cron/follow-ups", { authorization: "Bearer wrong" }),
      "follow-ups"
    );
    expect(result.ok).toBe(false);
  });
});
