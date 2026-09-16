// The machine-readable version of the status page.
//
// Exists so an uptime monitor can watch this rather than the home page, which
// would come back 200 with a perfectly rendered shell while the database was
// down. The HTTP code carries the verdict: 200 when everything the deployment
// has switched on is answering, 503 when something a business depends on is
// not — because a monitor reads the code, not the prose.

import { NextResponse } from "next/server";
import { status } from "@/lib/platform/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await status();
  return NextResponse.json(
    {
      status: report.overall,
      headline: report.headline,
      checkedAt: report.checkedAt.toISOString(),
      checks: report.checks.map((check) => ({ key: check.key, status: check.health, ms: check.ms, detail: check.detail })),
    },
    {
      status: report.overall === "down" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
