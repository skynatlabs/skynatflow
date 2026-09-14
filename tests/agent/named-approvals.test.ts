// Named agents and the approval path.
//
// The approval rule that matters: approving replays the exact arguments the
// gate held, as the approver — so approval can't be used to execute something
// the approver couldn't do themselves, and what a person sees on the screen is
// what actually runs.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { createAgent, listAgents, setAgentActive, deleteAgent } from "../../src/lib/agent/named";
import { approveRun, rejectRun, listPendingRuns } from "../../src/lib/agent/approvals";

let tenantId: string;
let userId: string;
let membershipId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Named Agent Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({
    data: { email: `named-${t.id}@test.local`, name: "Owner" },
  });
  userId = u.id;
  const m = await prisma.membership.create({
    data: { tenantId, userId, role: "OWNER" },
  });
  membershipId = m.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.agentDefinition.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("named agents", () => {
  it("creates, lists, pauses and removes an agent", async () => {
    const agent = await createAgent({
      tenantId,
      name: "Collections",
      brief: "Chase overdue money.",
      toolNames: ["findStaleDocuments", "createTask"],
      schedule: "0 9 * * 1-5",
    });

    let agents = await listAgents(tenantId);
    expect(agents.map((a) => a.name)).toContain("Collections");
    expect(agent.autonomy).toBe("SUGGEST_ONLY"); // safe by default

    await setAgentActive(tenantId, agent.id, false);
    agents = await listAgents(tenantId);
    expect(agents.find((a) => a.id === agent.id)?.isActive).toBe(false);

    await deleteAgent(tenantId, agent.id);
    agents = await listAgents(tenantId);
    expect(agents.find((a) => a.id === agent.id)).toBeUndefined();
  });

  it("refuses to touch an agent belonging to another tenant", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Named Co", niche: "RETAIL" } });
    const foreign = await createAgent({ tenantId: other.id, name: "Theirs", brief: "x" });

    await expect(setAgentActive(tenantId, foreign.id, false)).rejects.toThrow(/not found/i);
    await expect(deleteAgent(tenantId, foreign.id)).rejects.toThrow(/not found/i);

    await prisma.agentDefinition.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("keeps a run's audit trail when its agent is deleted", async () => {
    const agent = await createAgent({ tenantId, name: "Temp", brief: "x" });
    const run = await prisma.agentRun.create({
      data: { tenantId, agentId: agent.id, trigger: "AGENT", input: "did a thing", status: "DONE" },
    });

    await deleteAgent(tenantId, agent.id);

    const stillThere = await prisma.agentRun.findUnique({ where: { id: run.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.agentId).toBeNull();
  });
});

describe("approvals", () => {
  async function heldRun(tool: string, input: Record<string, unknown>) {
    return prisma.agentRun.create({
      data: {
        tenantId,
        trigger: "SCHEDULE",
        status: "AWAITING_APPROVAL",
        input: "scheduled review",
        reply: "I'd like to do one thing.",
        steps: [],
        pendingActions: JSON.parse(
          JSON.stringify([{ tool, input, reason: "held for approval" }])
        ),
      },
    });
  }

  it("lists runs that are waiting", async () => {
    const run = await heldRun("createTask", { title: "Call Acme" });
    const pending = await listPendingRuns(tenantId);
    expect(pending.map((r) => r.id)).toContain(run.id);
    await prisma.agentRun.delete({ where: { id: run.id } });
  });

  it("executes the exact held action on approval, as the approver", async () => {
    const run = await heldRun("createTask", { title: "Chase Acme invoice" });

    const outcome = await approveRun({
      tenantId,
      runId: run.id,
      approver: { userId, role: "OWNER", membershipId },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.executed[0].tool).toBe("createTask");

    // The task really exists, with the title that was on screen.
    const task = await prisma.task.findFirst({
      where: { tenantId, title: "Chase Acme invoice" },
    });
    expect(task).not.toBeNull();

    const after = await prisma.agentRun.findUnique({ where: { id: run.id } });
    expect(after?.status).toBe("APPROVED");
    expect(after?.resolvedBy).toBe(userId);

    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.agentRun.delete({ where: { id: run.id } });
  });

  it("refuses an action the approver's own role couldn't perform", async () => {
    const run = await heldRun("recordPayment", { invoiceId: "x", amountCents: 100 });

    // A DRIVER holds no payment:record capability, so the tool isn't in their
    // set at all — approving must not become an escalation path.
    const outcome = await approveRun({
      tenantId,
      runId: run.id,
      approver: { userId, role: "DRIVER", membershipId },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.executed[0].error).toMatch(/permission/i);

    await prisma.agentRun.delete({ where: { id: run.id } });
  });

  it("runs nothing when rejected", async () => {
    const run = await heldRun("createTask", { title: "Should never exist" });

    await rejectRun({ tenantId, runId: run.id, userId });

    const task = await prisma.task.findFirst({
      where: { tenantId, title: "Should never exist" },
    });
    expect(task).toBeNull();

    const after = await prisma.agentRun.findUnique({ where: { id: run.id } });
    expect(after?.status).toBe("REJECTED");

    await prisma.agentRun.delete({ where: { id: run.id } });
  });

  it("won't approve the same run twice", async () => {
    const run = await heldRun("createTask", { title: "Only once" });
    await approveRun({ tenantId, runId: run.id, approver: { userId, role: "OWNER", membershipId } });

    await expect(
      approveRun({ tenantId, runId: run.id, approver: { userId, role: "OWNER", membershipId } })
    ).rejects.toThrow(/isn't waiting/i);

    const tasks = await prisma.task.count({ where: { tenantId, title: "Only once" } });
    expect(tasks).toBe(1);

    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.agentRun.delete({ where: { id: run.id } });
  });

  it("won't approve a run from another tenant", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Approve Co", niche: "RETAIL" } });
    const foreign = await prisma.agentRun.create({
      data: {
        tenantId: other.id,
        trigger: "SCHEDULE",
        status: "AWAITING_APPROVAL",
        input: "theirs",
        pendingActions: [{ tool: "createTask", input: { title: "theirs" }, reason: "held" }],
      },
    });

    await expect(
      approveRun({ tenantId, runId: foreign.id, approver: { userId, role: "OWNER", membershipId } })
    ).rejects.toThrow(/not found/i);

    await prisma.agentRun.delete({ where: { id: foreign.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
