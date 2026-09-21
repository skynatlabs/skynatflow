// The PA command box, now backed by a real agent loop.
//
// This used to be a single-shot classifier: one generateObject call whose
// `intent` field was an enum of three values, then a code branch per value.
// Anything outside those three came back "I didn't understand" — even when
// the functions to answer it already existed in src/lib/core. There was no
// second step, no memory, and no way to compose two operations.
//
// Now the model gets the Business Graph as tools (scoped to this caller's
// role, with the tenant bound by the runtime rather than supplied by the
// model) and a step budget, and works the problem. See src/lib/agent/runtime.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { runAgent } from "@/lib/agent/runtime";
import { resolveThread } from "@/lib/agent/memory";
import { nicheConfig } from "@/lib/niches/config";
import { describePage } from "@/lib/agent/pageContext";
import { deriveReviewUrl } from "@/lib/agent/reviewUrl";
import { prisma } from "@/lib/db";
import { mayCallAgent } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const access = await requireTenantAccess(tenantId);

  // A model call is the one thing here that turns a keypress straight into a
  // bill, so the expensive endpoints are limited per person. Well above
  // normal working use; this stops a loop, not a busy afternoon.
  const gate = await mayCallAgent({ tenantId, userId: access.userId, kind: "agent" });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: gate.message },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { error: 'Tell me what you need — e.g. "who owes us the most, and draft a chase for the top three"' },
      { status: 400 }
    );
  }

  // Conversation continuity now lives server-side: the client passes a
  // threadId it was given, not the transcript, so history can't be forged or
  // grown without bound by whatever posts here.
  const threadId = await resolveThread({
    tenantId,
    userId: access.userId,
    threadId: typeof body?.threadId === "string" ? body.threadId : null,
    channel: "web",
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, niche: true },
  });

  // The page the request was made from. Derived from the path server-side so
  // a client can't hand the agent an entity type it made up — and scoped to
  // this tenant's prefix, so a pathname from another workspace resolves to
  // nothing rather than to a record the caller can't see.
  const page = describePage({
    path: typeof body?.path === "string" ? body.path : "",
    tenantId,
    customerLabel: nicheConfig(tenant.niche).customerLabel,
  });

  const result = await runAgent({
    ctx: {
      tenantId,
      role: access.role,
      capabilities: access.capabilities,
      userId: access.userId,
      membershipId: access.membershipId,
      customerLabel: nicheConfig(tenant.niche).customerLabel,
      currency: tenant.currency,
    },
    input: text,
    threadId,
    page,
  });

  // Surface the most useful thing the agent touched as a link, so the UI can
  // still offer "go and look at it" the way the old intent branches did.
  const reviewUrl = deriveReviewUrl(tenantId, result.steps);

  return NextResponse.json({
    ok: result.ok,
    reply: result.reply,
    mutated: result.mutated,
    threadId,
    runId: result.runId,
    pendingActions: result.pendingActions,
    // Named actions only — the raw tool payloads can contain a lot of data
    // and the client only ever renders the names.
    actions: result.steps.filter((s) => s.isMutation).map((s) => s.tool),
    reviewUrl,
    ...(result.ok ? {} : { error: result.reply }),
  });
}
