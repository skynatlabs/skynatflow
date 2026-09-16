// The MCP endpoint.
//
// Authenticated with the same API keys as /api/v1 — one credential for the
// whole platform, so connecting an assistant is the same act as connecting a
// script, and revoking a key revokes both.

import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api/keys";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import {
  handleMcpMessage,
  rpcError,
  MCP_PROTOCOL_VERSION,
  PARSE_ERROR,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A discovery page, so hitting the URL in a browser explains itself. */
export async function GET() {
  return NextResponse.json({
    name: "flow",
    description:
      "Read and act on a flow workspace: quotes, invoices, payments, customers, stock and work.",
    protocol: "mcp",
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: "streamable-http",
    authentication: {
      type: "bearer",
      description: "An API key from Settings → API & webhooks.",
    },
  });
}

export async function POST(req: NextRequest) {
  const verdict = await verifyApiKey(req.headers.get("authorization"));
  if (!verdict.ok) {
    // 401 with WWW-Authenticate, because MCP clients are written to prompt
    // for a credential on that and to give up on a bare 403.
    return NextResponse.json(
      rpcError(null, -32001, "Connect with an API key from Settings → API & webhooks."),
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="flow"' } }
    );
  }

  const { caller } = verdict;

  let message: JsonRpcRequest | JsonRpcRequest[];
  try {
    message = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, PARSE_ERROR, "Body wasn't valid JSON."), { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: caller.tenantId },
    select: {
      currency: true, name: true,
      niche: true,
      agentAutonomy: true,
      memberships: { where: { role: "OWNER" }, take: 1, select: { id: true, userId: true } },
    },
  });
  if (!tenant) {
    return NextResponse.json(rpcError(null, -32603, "Workspace not found."), { status: 404 });
  }

  // The key acts as itself, with its own role — but it needs a user to
  // attribute actions to, and the owner is who a workspace-level credential
  // stands in for. Same choice the scheduled agent tick makes.
  const owner = tenant.memberships[0];
  const session = {
    ctx: {
      tenantId: caller.tenantId,
      role: caller.role,
      userId: owner?.userId ?? caller.keyId,
      membershipId: owner?.id ?? null,
      customerLabel: nicheConfig(tenant.niche).customerLabel,
      currency: tenant.currency,
    },
    readOnly: caller.readOnly,
    autonomy: tenant.agentAutonomy,
    workspaceName: tenant.name,
  };

  // A client may batch. Notifications produce no reply and are filtered out.
  if (Array.isArray(message)) {
    const replies: JsonRpcResponse[] = [];
    for (const one of message) {
      const reply = await handleMcpMessage(one, session);
      if (reply) replies.push(reply);
    }
    return replies.length === 0
      ? new NextResponse(null, { status: 202 })
      : NextResponse.json(replies);
  }

  const reply = await handleMcpMessage(message, session);
  return reply ? NextResponse.json(reply) : new NextResponse(null, { status: 202 });
}
