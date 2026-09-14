// Approving one proposal without accepting the others.
//
// The agent often comes back with a bundle: chase this invoice AND add a late
// fee AND record a note. Before per-action approval the owner's only choices
// were all or nothing, which meant the safe click was "dismiss" — and a good
// proposal died alongside a bad one every time.
//
// These run against real rows because the properties that matter are about
// what is left in the queue afterwards, and what the run's final status says
// happened.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { approveAction, rejectAction, listPendingRuns } from "../../src/lib/agent/approvals";

let tenantId: string;
let userId: string;
let membershipId: string;
let partyId: string;
let invoiceA: string;
let invoiceB: string;

const approver = () => ({ userId, role: "OWNER" as const, membershipId });

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Partial Co", niche: "SERVICES" } });
  tenantId = t.id;
  const u = await prisma.user.create({ data: { email: `partial-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  const m = await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
  membershipId = m.id;
  const p = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Buyer" },
  });
  partyId = p.id;

  const mk = async (cents: number) =>
    (
      await prisma.transaction.create({
        data: {
          tenantId,
          partyId,
          type: TransactionType.INVOICE,
          status: TransactionStatus.SENT,
          amountCents: cents,
        },
      })
    ).id;
  invoiceA = await mk(1000_00);
  invoiceB = await mk(2000_00);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.domainEvent.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

/** A run holding two payments, as the gate would have left it. */
async function runHoldingTwo() {
  return prisma.agentRun.create({
    data: {
      tenantId,
      trigger: "SCHEDULE",
      status: "AWAITING_APPROVAL",
      input: "review the ledger",
      reply: "Two payments look like they landed — want me to record them?",
      steps: [],
      pendingActions: [
        {
          tool: "recordPayment",
          input: { invoiceId: invoiceA, amountCents: 1000_00 },
          reason: "moves money",
        },
        {
          tool: "recordPayment",
          input: { invoiceId: invoiceB, amountCents: 2000_00 },
          reason: "moves money",
        },
      ],
    },
  });
}

describe("approving one action at a time", () => {
  it("runs the chosen action and leaves the other waiting", async () => {
    const run = await runHoldingTwo();

    const result = await approveAction({ tenantId, runId: run.id, index: 0, approver: approver() });
    expect(result.ok).toBe(true);

    const after = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    // Still open: one proposal is unanswered, so the run is not resolved.
    expect(after.status).toBe("AWAITING_APPROVAL");
    expect(after.pendingActions).toHaveLength(1);

    // The approved one actually moved money; the held one did not.
    const a = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceA } });
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceB } });
    expect(a.status).toBe(TransactionStatus.PAID);
    expect(b.status).toBe(TransactionStatus.SENT);

    // And the queue reflects it.
    const stillPending = await listPendingRuns(tenantId);
    expect(stillPending.map((r) => r.id)).toContain(run.id);
  });

  it("closes the run as approved once the rest are declined", async () => {
    const run = await prisma.agentRun.findFirstOrThrow({
      where: { tenantId, status: "AWAITING_APPROVAL" },
      orderBy: { createdAt: "desc" },
    });

    await rejectAction({ tenantId, runId: run.id, index: 0, userId });

    const after = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    // One ran, one was turned down — that is an approved run, not a rejected
    // one, and the history should not flatten the difference.
    expect(after.status).toBe("APPROVED");
    expect(after.pendingActions).toBeNull();

    // The decline is recorded rather than erased.
    const steps = after.steps as Record<string, unknown>[];
    expect(steps.some((s) => s.declinedBy === userId)).toBe(true);
    expect(steps.some((s) => s.approvedBy === userId)).toBe(true);

    // Still untouched.
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceB } });
    expect(b.status).toBe(TransactionStatus.SENT);
  });

  it("closes the run as rejected when every action is declined", async () => {
    const run = await runHoldingTwo();

    await rejectAction({ tenantId, runId: run.id, index: 1, userId });
    await rejectAction({ tenantId, runId: run.id, index: 0, userId });

    const after = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("REJECTED");
  });

  it("refuses to run the same held action twice", async () => {
    const run = await runHoldingTwo();
    await approveAction({ tenantId, runId: run.id, index: 0, approver: approver() });

    // Index 0 is now the action that was at index 1 — the original is gone,
    // and a stale click from a second tab must not replay it.
    await approveAction({ tenantId, runId: run.id, index: 0, approver: approver() });
    await expect(
      approveAction({ tenantId, runId: run.id, index: 0, approver: approver() })
    ).rejects.toThrow(/already been dealt with|isn't waiting/i);
  });

  it("refuses an index that doesn't exist", async () => {
    const run = await runHoldingTwo();
    await expect(
      approveAction({ tenantId, runId: run.id, index: 9, approver: approver() })
    ).rejects.toThrow(/already been dealt with/i);
    await expect(
      rejectAction({ tenantId, runId: run.id, index: -1, userId })
    ).rejects.toThrow(/already been dealt with/i);
  });

  it("refuses a run belonging to another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Partial Co", niche: "RETAIL" } });
    const foreign = await prisma.agentRun.create({
      data: {
        tenantId: other.id,
        trigger: "USER",
        status: "AWAITING_APPROVAL",
        input: "x",
        steps: [],
        pendingActions: [{ tool: "recordPayment", input: {}, reason: "moves money" }],
      },
    });

    await expect(
      approveAction({ tenantId, runId: foreign.id, index: 0, approver: approver() })
    ).rejects.toThrow(/not found/i);

    const untouched = await prisma.agentRun.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.status).toBe("AWAITING_APPROVAL");
    expect(untouched.pendingActions).toHaveLength(1);

    await prisma.agentRun.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
