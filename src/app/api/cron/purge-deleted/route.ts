// The week is up.
//
// Workspaces whose owner asked to close them, and whose grace period has
// passed, are removed here — every table, driven off the schema so nothing
// added later quietly survives.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { purgeDueTenants } from "@/lib/core/accountClosure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = authorizeCron(req, "purge-deleted");
  if (!auth.ok) return auth.response;

  const purged = await purgeDueTenants();
  return NextResponse.json({ ok: true, purged: purged.length, rows: purged.reduce((n, p) => n + p.rows, 0) });
}
