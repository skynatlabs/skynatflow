// The agent's blast radius.
//
// Two properties matter more than anything the model says, and neither is
// enforced by the prompt:
//   1. No tool takes a tenantId, so a prompt-injected instruction has
//      nowhere to put another company's id.
//   2. A role only ever sees tools it actually holds the capability for.
// These assert both against the real registry, plus that the tools operate
// on live data correctly.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { buildAgentTools, agentToolNames, MUTATING_TOOLS } from "../../src/lib/agent/tools";
import type { AgentContext } from "../../src/lib/agent/tools";

let tenantId: string;
let otherTenantId: string;
let customerId: string;
let itemId: string;

const ctxFor = (role: AgentContext["role"], tid = tenantId): AgentContext => ({
  tenantId: tid,
  role,
  userId: "user-test",
  membershipId: null,
  customerLabel: "Customer",
});

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Agent Tools Co", niche: "SERVICES" } });
  const o = await prisma.tenant.create({ data: { name: "Agent Other Co", niche: "RETAIL" } });
  tenantId = t.id;
  otherTenantId = o.id;

  const c = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Agent Test Customer", phone: "+27820001111" },
  });
  customerId = c.id;
  const i = await prisma.item.create({
    data: { tenantId, name: "Agent Test Panel", unitPriceCents: 250000 },
  });
  itemId = i.id;

  // A same-named customer in the other tenant — the isolation canary.
  await prisma.party.create({
    data: { tenantId: otherTenantId, role: PartyRole.CUSTOMER, name: "Agent Test Customer" },
  });
});

afterAll(async () => {
  for (const t of [tenantId, otherTenantId]) {
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId: t } } });
    await prisma.transaction.deleteMany({ where: { tenantId: t } });
    await prisma.task.deleteMany({ where: { tenantId: t } });
    await prisma.event.deleteMany({ where: { tenantId: t } });
    await prisma.party.deleteMany({ where: { tenantId: t } });
    await prisma.item.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }
});

describe("tenant binding", () => {
  it("exposes no tool that accepts a tenantId", () => {
    const tools = buildAgentTools(ctxFor("OWNER"));
    for (const [name, def] of Object.entries(tools)) {
      const schema = JSON.stringify((def as { inputSchema?: unknown }).inputSchema ?? {});
      expect(schema, `${name} must not accept a tenantId`).not.toMatch(/tenantId/i);
    }
  });

  it("only ever returns rows from the bound tenant", async () => {
    const tools = buildAgentTools(ctxFor("OWNER"));
    const find = tools.findCustomers as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    const result = (await find.execute({ query: "Agent Test Customer" }, {})) as {
      total: number;
      customers: { id: string }[];
    };
    // Both tenants have a customer by this name; only one is ours.
    expect(result.total).toBe(1);
    expect(result.customers[0].id).toBe(customerId);
  });
});

describe("capability gating", () => {
  it("gives an OWNER the full write surface", () => {
    const names = agentToolNames("OWNER");
    expect(names).toContain("recordPayment");
    expect(names).toContain("createQuote");
    expect(names).toContain("sendQuote");
    expect(names).toContain("convertQuoteToInvoice");
  });

  it("withholds payment tools from a REP, who cannot record payments", () => {
    const names = agentToolNames("REP");
    expect(names).toContain("createQuote"); // a rep quotes
    expect(names).toContain("sendQuote");
    expect(names).not.toContain("recordPayment"); // but never takes money
    expect(names).not.toContain("recordRefund");
    expect(names).not.toContain("convertQuoteToInvoice");
  });

  it("leaves a DRIVER with almost no write surface", () => {
    const names = agentToolNames("DRIVER");
    expect(names).not.toContain("createQuote");
    expect(names).not.toContain("recordPayment");
    expect(names).toContain("scheduleAppointment"); // delivery:log
  });

  it("still gives every role the read tools", () => {
    for (const role of ["OWNER", "STAFF", "REP", "DRIVER", "TECHNICIAN"] as const) {
      const names = agentToolNames(role);
      expect(names, role).toContain("findCustomers");
      expect(names, role).toContain("businessSnapshot");
      expect(names, role).toContain("findStaleDocuments");
    }
  });

  it("builds exactly the tools it advertises for a role", () => {
    for (const role of ["OWNER", "REP", "DRIVER"] as const) {
      expect(Object.keys(buildAgentTools(ctxFor(role))).sort()).toEqual(agentToolNames(role).sort());
    }
  });
});

describe("tools do real work", () => {
  it("reports a business snapshot for the bound tenant", async () => {
    const tools = buildAgentTools(ctxFor("OWNER"));
    const snap = tools.businessSnapshot as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    const result = (await snap.execute({}, {})) as { customerCount: number };
    expect(result.customerCount).toBe(1);
  });

  it("creates a draft quote through the same core function the dashboard uses", async () => {
    const tools = buildAgentTools(ctxFor("OWNER"));
    const create = tools.createQuote as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    const result = (await create.execute(
      { customerId, lines: [{ itemId, quantity: 2, unitPriceCents: 250000 }] },
      {}
    )) as { quoteId: string; amountCents: number; status: string };

    expect(result.amountCents).toBe(500000);
    expect(result.status).toBe("DRAFT"); // never auto-sent
    const row = await prisma.transaction.findUnique({ where: { id: result.quoteId } });
    expect(row?.tenantId).toBe(tenantId);
  });

  it("refuses a quote naming a customer from another tenant", async () => {
    const foreign = await prisma.party.findFirstOrThrow({ where: { tenantId: otherTenantId } });
    const tools = buildAgentTools(ctxFor("OWNER"));
    const create = tools.createQuote as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    await expect(
      create.execute({ customerId: foreign.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100 }] }, {})
    ).rejects.toThrow(/not found/i);
  });
});

describe("run-log classification", () => {
  it("counts every write tool as a mutation and no read tool as one", () => {
    expect(MUTATING_TOOLS.has("createQuote")).toBe(true);
    expect(MUTATING_TOOLS.has("recordPayment")).toBe(true);
    expect(MUTATING_TOOLS.has("findCustomers")).toBe(false);
    expect(MUTATING_TOOLS.has("businessSnapshot")).toBe(false);
  });
});
