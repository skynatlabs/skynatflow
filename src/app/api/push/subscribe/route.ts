// Turning notifications on, and off.
//
// A route rather than a server action because the browser's own
// PushManager.subscribe() produces a plain object in the client, and posting
// it as JSON is the shortest honest path from there to the database.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { publicKey, pushConfigured, subscribe, unsubscribe } from "@/lib/core/push";

export const dynamic = "force-dynamic";

/** The key the browser needs before it can subscribe at all. */
export async function GET() {
  return NextResponse.json({ configured: pushConfigured(), publicKey: publicKey() });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as
    | { tenantId?: string; endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null;

  if (!payload?.tenantId || !payload.endpoint || !payload.keys?.p256dh || !payload.keys.auth) {
    return NextResponse.json({ error: "That is not a subscription we can use." }, { status: 400 });
  }

  // The tenant comes from the body, so it is checked rather than trusted —
  // otherwise anybody could register a device against somebody else's
  // workspace and be told about their money.
  const access = await requireTenantAccess(payload.tenantId);

  if (!access.membershipId) {
    return NextResponse.json({ error: "No membership on this workspace." }, { status: 403 });
  }

  await subscribe({
    tenantId: payload.tenantId,
    membershipId: access.membershipId,
    subscription: { endpoint: payload.endpoint, p256dh: payload.keys.p256dh, auth: payload.keys.auth },
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!payload?.endpoint) return NextResponse.json({ error: "No endpoint given." }, { status: 400 });

  // No access check on the way out, on purpose. The endpoint is a secret the
  // browser holds, so knowing it is proof enough — and somebody trying to
  // stop notifications should never be blocked by a permissions problem.
  await unsubscribe(payload.endpoint);
  return NextResponse.json({ ok: true });
}
