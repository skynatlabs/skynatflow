// Shared guard for every scheduled job.
//
// Replaces the per-route check `if (process.env.CRON_SECRET && secret !== ...)`,
// which was fail-OPEN: with CRON_SECRET unset — as it was in both .env and
// .env.example — the condition short-circuits and every cron endpoint is
// callable by anyone who knows the URL. Those endpoints send WhatsApp
// messages and email to every tenant's customers, so an open one is both a
// spam vector and a real bill.
//
// This version fails CLOSED: no configured secret means no scheduled job
// runs at all, and the reason is logged rather than silently allowed.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type CronAuthResult = { ok: true } | { ok: false; response: NextResponse };

export function authorizeCron(req: NextRequest, jobName: string): CronAuthResult {
  const configured = process.env.CRON_SECRET;

  if (!configured) {
    console.error(
      `[cron:${jobName}] refused: CRON_SECRET is not set. ` +
        `Scheduled jobs are disabled until it is configured in the environment.`
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Scheduled jobs are not configured on this deployment." },
        { status: 503 }
      ),
    };
  }

  // Vercel Cron signs its own invocations with this header, so the schedule
  // in vercel.json needs no secret in the URL (which would otherwise sit in
  // deploy logs). Anything else must present the shared secret.
  const vercelHeader = req.headers.get("authorization");
  if (vercelHeader && safeEqual(vercelHeader, `Bearer ${configured}`)) {
    return { ok: true };
  }

  const provided =
    req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";

  if (!safeEqual(provided, configured)) {
    console.warn(`[cron:${jobName}] refused: bad or missing secret`);
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

// Constant-time, and tolerant of a length mismatch (which timingSafeEqual
// throws on, and which would itself leak the secret's length).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
