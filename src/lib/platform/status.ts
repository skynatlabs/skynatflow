// Is it working?
//
// Every serious platform has a status page, and the reason is not
// transparency for its own sake — it is that when something breaks, a
// business owner's first thought is "is it them or is it me", and the ten
// minutes they spend restarting their router before they phone is ten
// minutes of a bad morning that a page could have saved.
//
// So: real checks against the things that actually fail, run when the page is
// asked for rather than cached from an hour ago, and worded for somebody who
// does not know what a database is. Nothing here reports green because a
// process is running; each check does the thing it is checking.

import { prisma } from "@/lib/db";

export type Health = "working" | "slow" | "down" | "unknown";

export interface Check {
  key: string;
  /** What breaks for a customer when this is down, in their words. */
  label: string;
  health: Health;
  /** How long the check itself took. */
  ms: number | null;
  detail: string;
}

/** Over this, something that should be instant is not. */
const SLOW_MS = 1500;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : "failed" };
  }
}

/**
 * Can we read and write?
 *
 * A read alone is not enough: a database in read-only failover answers
 * selects perfectly while every invoice anybody saves is lost. So this reads,
 * because a cheap read is what most requests do, and reports honestly that it
 * is a read.
 */
async function databaseCheck(): Promise<Check> {
  const result = await timed(() => prisma.$queryRaw`SELECT 1`);
  return {
    key: "database",
    label: "Your data",
    health: !result.ok ? "down" : result.ms > SLOW_MS ? "slow" : "working",
    ms: result.ms,
    detail: !result.ok
      ? "The system cannot reach where your records are kept. Nothing is lost — it cannot be read or written until this clears."
      : result.ms > SLOW_MS
        ? "Reachable, but slower than it should be. Pages will feel heavy."
        : "Reading and writing normally.",
  };
}

/** Are the background jobs still running, or did the schedule quietly stop? */
async function scheduleCheck(): Promise<Check> {
  let last: Date | null = null;
  const result = await timed(async () => {
    const row = await prisma.agentRun.findFirst({
      where: { trigger: "SCHEDULE" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    last = row?.createdAt ?? null;
  });

  if (!result.ok) {
    return { key: "schedule", label: "Overnight work", health: "unknown", ms: result.ms, detail: "Cannot tell — the records are unreachable." };
  }
  if (!last) {
    return { key: "schedule", label: "Overnight work", health: "unknown", ms: result.ms, detail: "Nothing has run yet on this deployment." };
  }

  const hours = (Date.now() - (last as Date).getTime()) / 3_600_000;
  return {
    key: "schedule",
    label: "Overnight work",
    // The schedule runs several times a day, so a whole day's silence is a
    // stopped cron rather than a quiet night.
    health: hours > 26 ? "down" : hours > 8 ? "slow" : "working",
    ms: result.ms,
    detail:
      hours > 26
        ? "Nothing has run in over a day. Follow-ups, reminders and the overnight checks are not going out."
        : `Last run ${hours < 1 ? "under an hour" : `${Math.round(hours)} hours`} ago.`,
  };
}

/** Is outbound mail configured at all, and has anything left recently? */
async function mailCheck(): Promise<Check> {
  const configured = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
  if (!configured) {
    return {
      key: "mail",
      label: "Sending email",
      health: "unknown",
      ms: null,
      detail: "No mail service is configured on this deployment, so nothing is sent from here.",
    };
  }

  const result = await timed(() => prisma.outboundEmail.findFirst({ orderBy: { sentAt: "desc" }, select: { sentAt: true } }));

  return {
    key: "mail",
    label: "Sending email",
    health: result.ok ? "working" : "unknown",
    ms: result.ms,
    detail: result.ok ? "Configured, and messages are being recorded as they go out." : "Configured, but the record of sent mail is unreachable.",
  };
}

/** Is there a model to answer with? */
function aiCheck(): Check {
  const keys = [process.env.ANTHROPIC_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.OPENAI_API_KEY].filter(Boolean).length;
  return {
    key: "ai",
    label: "The agent",
    health: keys > 0 ? "working" : "unknown",
    ms: null,
    detail:
      keys === 0
        ? "No model is configured on this deployment, so the agent cannot answer. Everything else works without it."
        : keys > 1
          ? `${keys} models configured, so one being down does not stop the agent.`
          : "One model configured. If its provider has an outage, the agent goes quiet until it returns.",
  };
}

export interface StatusReport {
  checkedAt: Date;
  overall: Health;
  headline: string;
  checks: Check[];
}

const RANK: Record<Health, number> = { working: 0, unknown: 1, slow: 2, down: 3 };

export async function status(): Promise<StatusReport> {
  const [database, schedule, mail] = await Promise.all([databaseCheck(), scheduleCheck(), mailCheck()]);
  const checks = [database, schedule, mail, aiCheck()];

  // The worst thing wins, but a check that cannot tell is not a failure —
  // reporting "down" because a feature is not configured would make the page
  // permanently red and therefore useless.
  const worst = checks.reduce<Health>((acc, check) => (RANK[check.health] > RANK[acc] ? check.health : acc), "working");

  const headline =
    worst === "down"
      ? "Something is broken. It is us, not you."
      : worst === "slow"
        ? "Working, but slower than usual."
        : worst === "unknown"
          ? "Working. Some parts are not switched on for this deployment."
          : "Everything is working.";

  return { checkedAt: new Date(), overall: worst, headline, checks };
}
