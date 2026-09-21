// The week is up.
//
// Workspaces whose owner asked to close them, and whose grace period has
// passed, are removed here — every table, driven off the schema so nothing
// added later quietly survives.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { purgeDueTenants } from "@/lib/core/accountClosure";
import { purgeOldRateEvents } from "@/lib/rateLimit";
import { purgeOldAuthEvents } from "@/lib/auth/events";
import { purgeOldQuerySamples } from "@/lib/perf";
import { purgeOldErrors } from "@/lib/errors";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = authorizeCron(req, "purge-deleted");
  if (!auth.ok) return auth.response;

  const purged = await purgeDueTenants();
  // Sign-in and signup throttling writes a row per attempt. None of it is
  // business data and none of it is worth keeping past the longest window we
  // check against, so it is swept on the same schedule.
  const rateEvents = await purgeOldRateEvents();
  // The authentication trail is kept for six months — long enough to
  // investigate, short enough not to become a liability of its own.
  const authEvents = await purgeOldAuthEvents();
  // Timing samples are kept a fortnight — long enough to see a regression
  // land, short enough that the table never becomes a thing to manage.
  const querySamples = await purgeOldQuerySamples(prisma);
  // Errors somebody marked handled, quiet for two months. An unresolved one
  // is never swept: it is still broken.
  const errors = await purgeOldErrors();
  return NextResponse.json({
    ok: true,
    purged: purged.length,
    rows: purged.reduce((n, p) => n + p.rows, 0),
    rateEvents,
    authEvents,
    querySamples,
    errors,
  });
}
