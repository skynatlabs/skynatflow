// The MCP server hands an outside assistant the keys to a business. The
// properties that matter are all about what it refuses to offer: money-moving
// tools, anything a read-only key shouldn't reach, and anything a workspace
// set to "nothing runs on its own" hasn't agreed to.

import { describe, it, expect } from "vitest";
import { handleMcpMessage, mcpToolsFor, describeTools, MCP_PROTOCOL_VERSION } from "../../src/lib/mcp/server";
import type { AgentContext } from "../../src/lib/agent/tools";

const ctx: AgentContext = {
  tenantId: "t_1",
  role: "OWNER",
  userId: "u_1",
  membershipId: "m_1",
  currency: "ZAR",
  customerLabel: "Customer",
};

const session = (over: Partial<Parameters<typeof mcpToolsFor>[0]> = {}) => ({
  ctx,
  readOnly: false,
  autonomy: "FULL" as const,
  workspaceName: "Test Co",
  ...over,
});

describe("the tool surface", () => {
  it("offers a broad set to a full-autonomy owner key", () => {
    const tools = mcpToolsFor(session());
    expect(Object.keys(tools).length).toBeGreaterThan(50);
  });

  it("never offers anything that moves money or contacts a customer", () => {
    // Nobody is watching an MCP call the way they watch a chat message, so
    // the gate's unattended rules apply — and those hold at every autonomy
    // level, FULL included.
    const tools = Object.keys(mcpToolsFor(session()));
    for (const forbidden of ["recordPayment", "recordRefund", "sendQuote", "convertQuoteToInvoice"]) {
      expect(tools, `${forbidden} must not be reachable over MCP`).not.toContain(forbidden);
    }
  });

  it("strips every write tool from a read-only key", () => {
    const tools = Object.keys(mcpToolsFor(session({ readOnly: true })));
    expect(tools).toContain("findCustomers");
    expect(tools).not.toContain("createQuote");
    expect(tools).not.toContain("createCustomer");
  });

  it("honours a workspace that said nothing runs on its own", () => {
    const suggest = Object.keys(mcpToolsFor(session({ autonomy: "SUGGEST_ONLY" })));
    const full = Object.keys(mcpToolsFor(session({ autonomy: "FULL" })));

    expect(suggest).toContain("findCustomers");
    expect(suggest).not.toContain("createQuote");
    expect(full).toContain("createQuote");
  });

  it("narrows by role, the same as everywhere else", () => {
    const driver = Object.keys(mcpToolsFor(session({ ctx: { ...ctx, role: "DRIVER" } })));
    expect(driver).toContain("logDelivery");
    expect(driver).not.toContain("createQuote");
  });

  it("describes every tool with a name, a description and a JSON schema", () => {
    const described = describeTools(mcpToolsFor(session()));
    expect(described.length).toBeGreaterThan(50);
    for (const tool of described) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(5);
      expect(tool.inputSchema).toHaveProperty("type");
    }
  });

  it("converts Zod to real JSON Schema rather than a permissive placeholder", () => {
    const described = describeTools(mcpToolsFor(session()));
    const find = described.find((t) => t.name === "findCustomers");
    const schema = find?.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties).toBeDefined();
    expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
  });

  it("never exposes tenantId as something a caller can set", () => {
    // The same invariant the agent tools hold: the workspace is closed over,
    // never an argument, so no prompt can redirect a call at another company.
    for (const tool of describeTools(mcpToolsFor(session()))) {
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/tenantId/);
    }
  });
});

describe("the protocol", () => {
  it("initializes with a version and instructions", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      session()
    );
    expect(reply).toBeTruthy();
    const result = (reply as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(String(result.instructions)).toContain("Test Co");
    expect(String(result.instructions)).toContain("cents");
  });

  it("answers ping and stays quiet on notifications", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "ping" }, session())).toMatchObject({
      result: {},
    });
    expect(
      await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, session())
    ).toBeNull();
  });

  it("lists tools", async () => {
    const reply = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, session());
    const tools = (reply as { result: { tools: unknown[] } }).result.tools;
    expect(tools.length).toBeGreaterThan(50);
  });

  it("refuses an unknown method and an unknown tool differently", async () => {
    const badMethod = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "resources/list" },
      session()
    );
    expect(badMethod).toHaveProperty("error.code", -32601);

    const badTool = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nonsenseTool" } },
      session()
    );
    expect(badTool).toHaveProperty("error.code", -32601);
  });

  it("says withheld rather than missing for a tool that exists but isn't offered", async () => {
    // An assistant told "no such tool" will tell the person flow can't do it.
    // Told "not available to this key", it can explain the real reason.
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "recordPayment" } },
      session()
    );
    expect(reply).toHaveProperty("error.code", -32000);
    expect(String((reply as { error: { message: string } }).error.message)).toMatch(/isn't available/i);
  });

  it("rejects anything that isn't JSON-RPC 2.0", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "1.0", id: 7, method: "tools/list" } as never,
      session()
    );
    expect(reply).toHaveProperty("error.code", -32600);
  });

  it("asks which tool when tools/call arrives without a name", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: {} },
      session()
    );
    expect(reply).toHaveProperty("error.code", -32602);
  });
});
