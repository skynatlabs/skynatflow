// flow as an MCP server.
//
// The Model Context Protocol is how AI assistants reach tools they don't own.
// Exposing flow over it means Claude, ChatGPT and anything that comes next can
// operate a business directly — read the ledger, draft a quote, chase an
// invoice — without us building a separate integration for each one.
//
// Nothing in this category has one. It is also nearly free for us, because the
// hard part is already built: the agent's 84 tools are tenant-scoped,
// capability-gated and written against the same core functions the dashboard
// calls. This file is a protocol adapter, not a second implementation — and
// that is the point. A parallel tool surface would be the thing that drifts.
//
// Transport is Streamable HTTP: JSON-RPC 2.0 over a single POST. The subset
// below (initialize, tools/list, tools/call, ping) is everything a client
// needs; implementing it directly rather than pulling in the SDK keeps the
// dependency surface honest for four message types.

import { z } from "zod";
import type { ToolSet } from "ai";
import { buildAgentTools, MUTATING_TOOLS, type AgentContext } from "@/lib/agent/tools";
import { canAutoRun } from "@/lib/agent/autonomy";
import type { AgentAutonomy } from "@prisma/client";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

// JSON-RPC's reserved range, plus our own for authorisation.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const FORBIDDEN = -32000;

export function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * The tool set this caller gets.
 *
 * Three filters, in order of how much they matter. The role decides which
 * tools exist at all (buildAgentTools). A read-only key then loses every
 * mutating one. Finally the workspace's own autonomy setting applies: a
 * business that has said "nothing runs on its own" means that for an outside
 * assistant too — arguably more so, since nobody here is watching.
 */
export function mcpToolsFor(params: {
  ctx: AgentContext;
  readOnly: boolean;
  autonomy: AgentAutonomy;
}): ToolSet {
  const all = buildAgentTools(params.ctx);
  const allowed: ToolSet = {};

  for (const [name, def] of Object.entries(all)) {
    if (!MUTATING_TOOLS.has(name)) {
      allowed[name] = def;
      continue;
    }
    if (params.readOnly) continue;

    // userPresent: false — an MCP client is not a person sitting in flow with
    // the consequences on screen. Anything the gate would hold for approval
    // is simply not offered, rather than offered and then refused.
    const verdict = canAutoRun({ toolName: name, autonomy: params.autonomy, userPresent: false, isMutation: true });
    if (!verdict.allowed) continue;

    allowed[name] = def;
  }

  return allowed;
}

/** MCP wants JSON Schema; the tools are declared in Zod. */
function toJsonSchema(inputSchema: unknown): Record<string, unknown> {
  try {
    if (inputSchema && typeof inputSchema === "object" && "_zod" in inputSchema) {
      return z.toJSONSchema(inputSchema as z.ZodType, { io: "input" }) as Record<string, unknown>;
    }
  } catch {
    // Fall through to the permissive shape rather than dropping the tool: a
    // tool a client cannot see is worse than one whose arguments it has to
    // infer from the description.
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

export function describeTools(tools: ToolSet) {
  return Object.entries(tools).map(([name, def]) => {
    const t = def as { description?: string; inputSchema?: unknown };
    return {
      name,
      description: t.description ?? name,
      inputSchema: toJsonSchema(t.inputSchema),
    };
  });
}

export interface McpSession {
  ctx: AgentContext;
  readOnly: boolean;
  autonomy: AgentAutonomy;
  workspaceName: string;
}

/** Handles one JSON-RPC message. */
export async function handleMcpMessage(
  message: JsonRpcRequest,
  session: McpSession
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.");
  }

  // Notifications carry no id and expect no reply.
  const isNotification = message.id === undefined || message.id === null;

  switch (message.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: `flow · ${session.workspaceName}`,
          version: "1.0.0",
        },
        instructions:
          `You are connected to ${session.workspaceName}'s flow workspace — its quotes, ` +
          `invoices, payments, customers, stock and work. Money is always in cents. ` +
          `Look things up before acting: resolve a name to an id with findCustomers or ` +
          `findDocuments rather than guessing one. Anything that would move money or ` +
          `contact a customer is deliberately not available here.`,
      });

    case "notifications/initialized":
      return null;

    case "ping":
      return rpcResult(id, {});

    case "tools/list": {
      const tools = mcpToolsFor(session);
      return rpcResult(id, { tools: describeTools(tools) });
    }

    case "tools/call": {
      const name = message.params?.name;
      if (typeof name !== "string") {
        return rpcError(id, INVALID_PARAMS, "Which tool? Send params.name.");
      }

      const tools = mcpToolsFor(session);
      const def = tools[name] as
        | { execute?: (input: unknown, opts: unknown) => Promise<unknown> }
        | undefined;

      if (!def?.execute) {
        // Deliberately distinguishes "no such tool" from "not for you": an
        // assistant that is told the tool exists but is withheld can explain
        // that to the person, instead of insisting flow cannot do it.
        const exists = Object.keys(buildAgentTools(session.ctx)).includes(name);
        return exists
          ? rpcError(id, FORBIDDEN, `"${name}" isn't available to this key — it moves money, contacts a customer, or the key is read-only.`)
          : rpcError(id, METHOD_NOT_FOUND, `No tool called "${name}".`);
      }

      try {
        const output = await def.execute(message.params?.arguments ?? {}, {});
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(output ?? { ok: true }, null, 2) }],
          isError: false,
        });
      } catch (err) {
        // A tool refusing ("Customer not found.") is a result the assistant
        // should read and act on, not a transport failure. Returned as an
        // error-flagged result rather than a JSON-RPC error for that reason.
        const text = err instanceof Error ? err.message : "That didn't work.";
        console.error(`[mcp:${session.ctx.tenantId}] ${name} failed:`, err);
        return rpcResult(id, {
          content: [{ type: "text", text }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return rpcError(id, METHOD_NOT_FOUND, `Unsupported method "${message.method}".`);
  }
}

export { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR, FORBIDDEN };
