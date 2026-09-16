// The statements, fetching themselves.
//
// Every connected feed, one at a time, with failures contained: one bank
// refusing a request must not stop the other nine workspaces getting theirs.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { syncAllFeeds } from "@/lib/core/bankFeeds";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = authorizeCron(req, "bank-feeds");
  if (!auth.ok) return auth.response;

  const result = await syncAllFeeds();
  return NextResponse.json({ ok: true, ...result });
}
