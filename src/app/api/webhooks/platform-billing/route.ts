// The gateway telling us a workspace has paid for flow.
//
// Same shape as the tenant payment webhook: read the RAW body before parsing
// anything, because every signature scheme signs the bytes that were sent.
// A callback that does not verify changes nothing — this endpoint is public
// by necessity, so the signature is the only thing standing between a
// stranger and a free subscription.

import { NextRequest, NextResponse } from "next/server";
import { handleBillingWebhook } from "@/lib/billing/collect";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const result = await handleBillingWebhook({
    rawBody,
    headers,
    sourceIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  });

  // 200 even when ignored: a gateway that gets a non-200 retries forever, and
  // there is nothing to retry for a callback we correctly refused.
  return NextResponse.json({ ok: result.ok, outcome: result.outcome });
}
