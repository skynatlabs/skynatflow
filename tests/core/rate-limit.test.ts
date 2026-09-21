// Sign-in throttling and general rate limiting.
//
// The properties worth asserting are the ones that are easy to lose in a
// refactor and expensive to lose in production: that a lockout expires on its
// own, that a success clears the count, that the refusal message does not
// tell an attacker whether the account exists, and that one workspace's
// limit is not another's.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  LOGIN_ACCOUNT,
  check,
  clear,
  consume,
  hit,
  loginAccountBucket,
  loginAddressBucket,
  mayAttemptLogin,
  purgeOldRateEvents,
  recordLoginOutcome,
  mayCallAgent,
  AGENT_PER_MINUTE,
} from "../../src/lib/rateLimit";
import {
  purgeOldAuthEvents,
  recentAuthEvents,
  recordAuthEvent,
} from "../../src/lib/auth/events";

const EMAIL = "throttle-test@example.com";
const OTHER = "throttle-other@example.com";
const IP = "203.0.113.77";

async function wipe() {
  await prisma.rateEvent.deleteMany({
    where: {
      bucket: {
        in: [
          loginAccountBucket(EMAIL),
          loginAccountBucket(OTHER),
          loginAddressBucket(IP),
          "test:bucket",
          "test:other",
        ],
      },
    },
  });
}

beforeEach(wipe);
afterAll(wipe);

describe("counting", () => {
  it("allows up to the limit and refuses past it", async () => {
    const limit = { bucket: "test:bucket", limit: 3, windowSeconds: 600 };

    for (let i = 0; i < 3; i++) {
      const verdict = await consume(limit);
      expect(verdict.allowed, `attempt ${i + 1}`).toBe(true);
    }
    const fourth = await consume(limit);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each bucket separately", async () => {
    const a = { bucket: "test:bucket", limit: 1, windowSeconds: 600 };
    const b = { bucket: "test:other", limit: 1, windowSeconds: 600 };

    expect((await consume(a)).allowed).toBe(true);
    expect((await consume(a)).allowed).toBe(false);
    // b is untouched by a's exhaustion.
    expect((await consume(b)).allowed).toBe(true);
  });

  it("forgets events that fall out of the window", async () => {
    const limit = { bucket: "test:bucket", limit: 2, windowSeconds: 60 };
    const longAgo = new Date(Date.now() - 10 * 60_000);

    await hit(limit.bucket, longAgo);
    await hit(limit.bucket, longAgo);
    // Both are older than the window, so nothing counts against us.
    expect((await check(limit)).allowed).toBe(true);
    expect((await check(limit)).remaining).toBe(2);
  });

  it("still records an attempt that was refused", async () => {
    // Otherwise somebody hammering a limit walks the window forward with
    // every refusal and gets a free attempt as soon as the oldest expires.
    const limit = { bucket: "test:bucket", limit: 1, windowSeconds: 600 };
    await consume(limit);
    await consume(limit);
    const rows = await prisma.rateEvent.count({ where: { bucket: limit.bucket } });
    expect(rows).toBe(2);
  });
});

describe("signing in", () => {
  it("lets a normal person in", async () => {
    const gate = await mayAttemptLogin({ email: EMAIL, ip: IP });
    expect(gate.allowed).toBe(true);
  });

  it("shuts the door after enough wrong answers", async () => {
    for (let i = 0; i < LOGIN_ACCOUNT.limit; i++) {
      await recordLoginOutcome({ email: EMAIL, ip: IP, ok: false });
    }
    const gate = await mayAttemptLogin({ email: EMAIL, ip: IP });
    expect(gate.allowed).toBe(false);
    expect(gate.message).toMatch(/too many sign-in attempts/i);
  });

  it("says the same thing whether or not the account exists", async () => {
    // Account enumeration: the refusal must not be a way to ask us which
    // addresses are real.
    for (let i = 0; i < LOGIN_ACCOUNT.limit; i++) {
      await recordLoginOutcome({ email: EMAIL, ok: false });
      await recordLoginOutcome({ email: OTHER, ok: false });
    }
    const real = await mayAttemptLogin({ email: EMAIL });
    const imaginary = await mayAttemptLogin({ email: OTHER });
    expect(real.message).toBe(imaginary.message);
  });

  it("clears the count when somebody finally gets it right", async () => {
    for (let i = 0; i < LOGIN_ACCOUNT.limit - 1; i++) {
      await recordLoginOutcome({ email: EMAIL, ip: IP, ok: false });
    }
    await recordLoginOutcome({ email: EMAIL, ip: IP, ok: true });

    const remaining = await check({ bucket: loginAccountBucket(EMAIL), ...LOGIN_ACCOUNT });
    expect(remaining.remaining).toBe(LOGIN_ACCOUNT.limit);
    expect((await mayAttemptLogin({ email: EMAIL, ip: IP })).allowed).toBe(true);
  });

  it("opens again on its own, without anybody being phoned", async () => {
    const stale = new Date(Date.now() - (LOGIN_ACCOUNT.windowSeconds + 60) * 1000);
    for (let i = 0; i < LOGIN_ACCOUNT.limit + 2; i++) {
      await hit(loginAccountBucket(EMAIL), stale);
    }
    expect((await mayAttemptLogin({ email: EMAIL })).allowed).toBe(true);
  });

  it("locks one account without locking everybody else out", async () => {
    for (let i = 0; i < LOGIN_ACCOUNT.limit; i++) {
      await recordLoginOutcome({ email: EMAIL, ok: false });
    }
    expect((await mayAttemptLogin({ email: EMAIL })).allowed).toBe(false);
    expect((await mayAttemptLogin({ email: OTHER })).allowed).toBe(true);
  });

  it("is case- and whitespace-insensitive about the address", async () => {
    // Otherwise "  Someone@Example.com " is a fresh allowance every time.
    expect(loginAccountBucket("  Someone@Example.com ")).toBe(loginAccountBucket("someone@example.com"));
  });
});

describe("housekeeping", () => {
  it("sweeps events older than the longest window", async () => {
    await hit("test:bucket", new Date(Date.now() - 72 * 3_600_000));
    await hit("test:bucket");
    const removed = await purgeOldRateEvents(48);
    expect(removed).toBeGreaterThanOrEqual(1);
    // The recent one survives.
    expect(await prisma.rateEvent.count({ where: { bucket: "test:bucket" } })).toBe(1);
    await clear("test:bucket");
  });
});

// The authentication trail. Required by name in every enterprise security
// review, and the one kind of event AuditLog cannot hold, because a sign-in
// happens before any workspace is chosen.
describe("the authentication trail", () => {
  beforeEach(async () => {
    await prisma.authEvent.deleteMany({ where: { email: EMAIL } });
  });

  it("records successes and failures alike", async () => {
    await recordAuthEvent({ email: EMAIL, kind: "SIGNIN_FAILED", ip: IP });
    await recordAuthEvent({ email: EMAIL, kind: "SIGNIN_OK", ip: IP });

    const rows = await recentAuthEvents(EMAIL);
    expect(rows.map((r) => r.kind)).toEqual(["SIGNIN_OK", "SIGNIN_FAILED"]);
    expect(rows[0].label).toBe("Signed in");
  });

  it("normalises the address, so one account is one trail", async () => {
    await recordAuthEvent({ email: "  ThrottLE-Test@Example.com ", kind: "SIGNIN_OK" });
    expect(await recentAuthEvents(EMAIL)).toHaveLength(1);
  });

  it("never throws into the caller", async () => {
    // A log table having a bad day must not be able to stop somebody signing
    // in to their own business.
    await expect(
      recordAuthEvent({ email: EMAIL, kind: "NOT_A_REAL_KIND" as never })
    ).resolves.toBeUndefined();
  });

  it("forgets events past the retention window", async () => {
    await recordAuthEvent({ email: EMAIL, kind: "SIGNIN_OK", at: new Date(Date.now() - 400 * 86_400_000) });
    await recordAuthEvent({ email: EMAIL, kind: "SIGNIN_OK" });
    await purgeOldAuthEvents(180);
    expect(await recentAuthEvents(EMAIL)).toHaveLength(1);
  });
});

// The endpoints that turn a keypress into a bill.
describe("expensive endpoints", () => {
  const tenantId = "t_limit_test";
  const userId = "u_limit_test";

  beforeEach(async () => {
    await prisma.rateEvent.deleteMany({ where: { bucket: { startsWith: `agent:${tenantId}:` } } });
  });

  it("lets normal use through", async () => {
    for (let i = 0; i < 5; i++) {
      const gate = await mayCallAgent({ tenantId, userId });
      expect(gate.allowed, `call ${i + 1}`).toBe(true);
    }
  });

  it("stops a loop", async () => {
    for (let i = 0; i < AGENT_PER_MINUTE.limit; i++) {
      await mayCallAgent({ tenantId, userId });
    }
    const gate = await mayCallAgent({ tenantId, userId });
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBeGreaterThan(0);
    // The message must not read as data loss — the work already running is fine.
    expect(gate.message).toMatch(/nothing has been lost/i);
  });

  it("limits one person without limiting their colleague", async () => {
    for (let i = 0; i < AGENT_PER_MINUTE.limit; i++) {
      await mayCallAgent({ tenantId, userId });
    }
    expect((await mayCallAgent({ tenantId, userId })).allowed).toBe(false);
    expect((await mayCallAgent({ tenantId, userId: "u_colleague" })).allowed).toBe(true);
    await prisma.rateEvent.deleteMany({ where: { bucket: { contains: "u_colleague" } } });
  });

  it("counts each kind of call separately", async () => {
    for (let i = 0; i < AGENT_PER_MINUTE.limit; i++) {
      await mayCallAgent({ tenantId, userId });
    }
    expect((await mayCallAgent({ tenantId, userId })).allowed).toBe(false);
    // Reading a document is not the same budget as driving the agent.
    expect((await mayCallAgent({ tenantId, userId, kind: "extract" })).allowed).toBe(true);
    await prisma.rateEvent.deleteMany({ where: { bucket: { startsWith: `extract:${tenantId}:` } } });
  });
});
