// Sending what the event bus queued.
//
// Separate from emission on purpose: an endpoint that is down must not slow
// down, or fail, the business operation that produced the event. Queue in the
// request, send on the tick.

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { dispatchDueWebhooks } from "@/lib/api/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = authorizeCron(req, "webhook-dispatch");
  if (!auth.ok) return auth.response;

  const result = await dispatchDueWebhooks();
  return NextResponse.json({ ok: true, ...result });
}
