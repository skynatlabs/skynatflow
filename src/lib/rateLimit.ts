// Slowing down the things that are cheap to attack.
//
// Two different problems wear the same word, and they want opposite
// treatment. A RATE LIMIT protects a shared resource from one caller in a
// loop. A LOCKOUT protects one account from everybody else guessing at it.
// The first should be forgiving and per-caller; the second has to be
// unforgiving and per-account, or it is decoration.
//
// Both are built on counting recent events rather than incrementing a
// counter, because a counter needs a lock to stay correct under concurrency
// and silently drifts the first time one write is lost. Rows are cheap and
// purged nightly.
//
// What this deliberately is not: a high-throughput limiter. Every check is a
// query, so it is applied where an attack is cheap and the damage is real —
// signing in, signing up, the assistant endpoints — and not on every request
// in the application. If that is ever needed, the answer is Redis rather than
// more of this.

import { prisma } from "@/lib/db";

export interface Limit {
  /** What is being counted. Include the identity: "login:a@b.com". */
  bucket: string;
  /** How many are allowed inside the window. */
  limit: number;
  windowSeconds: number;
}

export interface Verdict {
  allowed: boolean;
  /** How many remain before the limit bites. */
  remaining: number;
  /** Seconds until the oldest event in the window falls out of it. */
  retryAfterSeconds: number;
}

/**
 * Count what has happened, and say whether one more is allowed.
 *
 * Does NOT record the attempt — `hit` does that. Kept separate because the
 * caller usually needs to decide before doing the work and record after
 * knowing the outcome, and a check that also records cannot express
 * "successful logins don't count against you".
 */
export async function check(limit: Limit, now = new Date()): Promise<Verdict> {
  const since = new Date(now.getTime() - limit.windowSeconds * 1000);
  const events = await prisma.rateEvent.findMany({
    where: { bucket: limit.bucket, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { at: true },
    take: limit.limit + 1,
  });

  const used = events.length;
  const allowed = used < limit.limit;
  const oldest = events[0]?.at;
  const retryAfterSeconds =
    allowed || !oldest
      ? 0
      : Math.max(1, Math.ceil((oldest.getTime() + limit.windowSeconds * 1000 - now.getTime()) / 1000));

  return { allowed, remaining: Math.max(0, limit.limit - used), retryAfterSeconds };
}

/** Record that it happened. */
export async function hit(bucket: string, now = new Date()): Promise<void> {
  await prisma.rateEvent.create({ data: { bucket, at: now } });
}

/** Forget this bucket — what a successful sign-in does to a failure count. */
export async function clear(bucket: string): Promise<void> {
  await prisma.rateEvent.deleteMany({ where: { bucket } });
}

/**
 * Check and record in one call, for the ordinary case.
 *
 * Records even when refused: somebody hammering a limit should not have the
 * window slide out from under them by being refused.
 */
export async function consume(limit: Limit, now = new Date()): Promise<Verdict> {
  const verdict = await check(limit, now);
  await hit(limit.bucket, now);
  return verdict;
}

/** Anything older than the longest window we use is noise. */
export async function purgeOldRateEvents(olderThanHours = 48, now = new Date()): Promise<number> {
  const { count } = await prisma.rateEvent.deleteMany({
    where: { at: { lt: new Date(now.getTime() - olderThanHours * 3_600_000) } },
  });
  return count;
}

// ------------------------------------------------------------------ login

/**
 * The sign-in limits.
 *
 * Per account, because that is the attack that matters: a password sprayed
 * across one account until it opens. Per address as well, because the same
 * attacker tries a thousand accounts from one place and a purely per-account
 * limit never sees it.
 *
 * Both expire on their own. A lockout with no way out is a support queue, and
 * a support queue is how lockouts get switched off.
 */
export const LOGIN_ACCOUNT: Omit<Limit, "bucket"> = { limit: 8, windowSeconds: 15 * 60 };
export const LOGIN_ADDRESS: Omit<Limit, "bucket"> = { limit: 40, windowSeconds: 15 * 60 };

export function loginAccountBucket(email: string): string {
  return `login:account:${email.trim().toLowerCase()}`;
}

export function loginAddressBucket(ip: string): string {
  return `login:ip:${ip}`;
}

export interface LoginGate {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Said to the person, and deliberately the same whether or not the account exists. */
  message: string;
}

/**
 * Whether this sign-in may even be attempted.
 *
 * The message never distinguishes "too many attempts on an account that
 * exists" from "on one that does not" — that difference is an account
 * enumeration oracle, and it is the reason this returns a message rather than
 * letting each caller phrase its own.
 */
export async function mayAttemptLogin(params: { email: string; ip?: string | null }, now = new Date()): Promise<LoginGate> {
  const checks = [check({ bucket: loginAccountBucket(params.email), ...LOGIN_ACCOUNT }, now)];
  if (params.ip) checks.push(check({ bucket: loginAddressBucket(params.ip), ...LOGIN_ADDRESS }, now));

  const verdicts = await Promise.all(checks);
  const blocked = verdicts.find((v) => !v.allowed);
  if (!blocked) return { allowed: true, retryAfterSeconds: 0, message: "" };

  const minutes = Math.max(1, Math.ceil(blocked.retryAfterSeconds / 60));
  return {
    allowed: false,
    retryAfterSeconds: blocked.retryAfterSeconds,
    message: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

/** A failed attempt counts. A successful one wipes the account's slate. */
export async function recordLoginOutcome(
  params: { email: string; ip?: string | null; ok: boolean },
  now = new Date()
): Promise<void> {
  if (params.ok) {
    await clear(loginAccountBucket(params.email));
    return;
  }
  await hit(loginAccountBucket(params.email), now);
  if (params.ip) await hit(loginAddressBucket(params.ip), now);
}

// ------------------------------------------------------- expensive endpoints

/**
 * The endpoints that cost real money per call.
 *
 * A model call is the only thing in this application where one person holding
 * a key down turns directly into a bill. The limit is per person rather than
 * per workspace, so one enthusiastic user cannot exhaust their colleagues'
 * afternoon, and it is set well above what anybody working normally does —
 * this is a guard against a loop or a script, not a quota. The quota is a
 * separate idea and lives in core/quotas.ts.
 */
export const AGENT_PER_MINUTE: Omit<Limit, "bucket"> = { limit: 20, windowSeconds: 60 };
export const AGENT_PER_HOUR: Omit<Limit, "bucket"> = { limit: 300, windowSeconds: 60 * 60 };

export interface EndpointGate {
  allowed: boolean;
  retryAfterSeconds: number;
  message: string;
}

/**
 * May this person make another expensive call?
 *
 * Records the attempt whatever the answer, so that a script being refused
 * does not walk the window forward and earn itself a free call.
 */
export async function mayCallAgent(
  params: { tenantId: string; userId: string; kind?: string },
  now = new Date()
): Promise<EndpointGate> {
  const who = `${params.kind ?? "agent"}:${params.tenantId}:${params.userId}`;

  const [minute, hour] = await Promise.all([
    check({ bucket: `${who}:m`, ...AGENT_PER_MINUTE }, now),
    check({ bucket: `${who}:h`, ...AGENT_PER_HOUR }, now),
  ]);
  await Promise.all([hit(`${who}:m`, now), hit(`${who}:h`, now)]);

  const blocked = !minute.allowed ? minute : !hour.allowed ? hour : null;
  if (!blocked) return { allowed: true, retryAfterSeconds: 0, message: "" };

  return {
    allowed: false,
    retryAfterSeconds: blocked.retryAfterSeconds,
    message:
      "That is a lot of requests in a short time. Give it a moment — nothing has been lost, " +
      "and anything already running will finish.",
  };
}
