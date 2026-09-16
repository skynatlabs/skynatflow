// The same agent run, watched rather than waited for.
//
// A twelve-step run takes the better part of a minute. Against the POST
// endpoint the browser shows three bouncing dots for all of it, which is the
// difference between software that feels like it's thinking and software that
// feels like it's hung — and worse, it hides the one thing an owner most
// wants to see, which is what it touched on the way to its answer.
//
// NDJSON rather than SSE: one JSON object per line is the whole protocol, the
// client needs no EventSource (which can't POST), and the final line carries
// exactly the payload the POST route returns, so both surfaces agree.

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { runAgent, type AgentProgress } from "@/lib/agent/runtime";
import { resolveThread } from "@/lib/agent/memory";
import { describePage } from "@/lib/agent/pageContext";
import { nicheConfig } from "@/lib/niches/config";
import { prisma } from "@/lib/db";
import { deriveReviewUrl } from "@/lib/agent/reviewUrl";

export const dynamic = "force-dynamic";
// Long enough for a full multi-step run; the client sees progress throughout.
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const access = await requireTenantAccess(tenantId);

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Tell me what you need." }, { status: 400 });
  }

  const threadId = await resolveThread({
    tenantId,
    userId: access.userId,
    threadId: typeof body?.threadId === "string" ? body.threadId : null,
    channel: "web",
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { niche: true, currency: true },
  });
  const customerLabel = nicheConfig(tenant.niche).customerLabel;

  const page = describePage({
    path: typeof body?.path === "string" ? body.path : "",
    tenantId,
    customerLabel,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        } catch {
          // The reader went away — the user closed the panel or navigated.
          // The run itself carries on and is recorded either way.
          closed = true;
        }
      };

      write({ type: "start", threadId });

      try {
        const result = await runAgent({
          ctx: {
            tenantId,
            currency: tenant.currency,
            role: access.role,
            userId: access.userId,
            membershipId: access.membershipId,
            customerLabel,
          },
          input: text,
          threadId,
          page,
          onProgress: (event: AgentProgress) => write(event),
        });

        write({
          type: "done",
          ok: result.ok,
          reply: result.reply,
          mutated: result.mutated,
          threadId,
          runId: result.runId,
          pendingActions: result.pendingActions,
          actions: result.steps.filter((s) => s.isMutation).map((s) => s.tool),
          reviewUrl: deriveReviewUrl(tenantId, result.steps),
          ...(result.ok ? {} : { error: result.reply }),
        });
      } catch (err) {
        console.error(`[agent:stream:${tenantId}]`, err);
        write({
          type: "done",
          ok: false,
          reply: "Something went wrong while I was working on that.",
          threadId,
          pendingActions: [],
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Proxies that buffer would defeat the whole point.
      "X-Accel-Buffering": "no",
    },
  });
}
