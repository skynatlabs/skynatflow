// Job cards — the work-order layer for service businesses. See
// src/lib/core/jobCards.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { createQuote, recordResponse } from "../../src/lib/core/money";
import { createJobCard, toggleJobCardTask, completeJobCard, setJobCardStatus, listJobCards } from "../../src/lib/core/jobCards";

let tenantId: string;
let customerId: string;
let itemId: string;
let transactionId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Job Card Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Job Card Customer" } });
  customerId = customer.id;
  const item = await prisma.item.create({ data: { tenantId, name: "Install Job Widget", unitPriceCents: 500000 } });
  itemId = item.id;
  const quote = await createQuote({ tenantId, partyId: customerId, lines: [{ itemId, quantity: 1, unitPriceCents: 500000 }] });
  await recordResponse(quote.id, "ACCEPTED");
  transactionId = quote.id;
});

afterAll(async () => {
  await prisma.jobCardTask.deleteMany({ where: { jobCard: { tenantId } } });
  await prisma.jobCard.deleteMany({ where: { tenantId } });
  const memberships = await prisma.membership.findMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("createJobCard", () => {
  it("creates the checklist tasks in the given order", async () => {
    const jobCard = await createJobCard({
      tenantId, transactionId, partyId: customerId, title: "Solar install",
      taskLabels: ["Mount panels", "Wire inverter", "Test system"],
    });
    expect(jobCard.tasks).toHaveLength(3);
    expect(jobCard.tasks.map((t) => t.label)).toEqual(["Mount panels", "Wire inverter", "Test system"]);
    expect(jobCard.status).toBe("SCHEDULED");
  });
});

describe("completeJobCard", () => {
  it("refuses to complete a job card with unticked checklist items", async () => {
    const jobCard = await createJobCard({
      tenantId, transactionId, partyId: customerId, title: "Incomplete install",
      taskLabels: ["Step one", "Step two"],
    });
    await expect(completeJobCard(tenantId, jobCard.id)).rejects.toThrow(/checklist/i);
  });

  it("completes once every task is ticked off", async () => {
    const jobCard = await createJobCard({
      tenantId, transactionId, partyId: customerId, title: "Full install",
      taskLabels: ["Step one", "Step two"],
    });
    for (const task of jobCard.tasks) {
      await toggleJobCardTask(tenantId, task.id);
    }

    const completed = await completeJobCard(tenantId, jobCard.id, "https://example.com/photo.jpg");
    expect(completed.status).toBe("DONE");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completionPhotoUrl).toBe("https://example.com/photo.jpg");
  });

  it("allows a job card with no checklist at all to be completed immediately", async () => {
    const jobCard = await createJobCard({ tenantId, transactionId, partyId: customerId, title: "No checklist job" });
    const completed = await completeJobCard(tenantId, jobCard.id);
    expect(completed.status).toBe("DONE");
  });
});

describe("toggleJobCardTask", () => {
  it("toggles a task back off when called twice", async () => {
    const jobCard = await createJobCard({ tenantId, transactionId, partyId: customerId, title: "Toggle test", taskLabels: ["Only step"] });
    const task = jobCard.tasks[0];

    const toggledOn = await toggleJobCardTask(tenantId, task.id);
    expect(toggledOn.isDone).toBe(true);

    const toggledOff = await toggleJobCardTask(tenantId, task.id);
    expect(toggledOff.isDone).toBe(false);
  });
});

describe("setJobCardStatus", () => {
  it("clears completedAt when moved back off DONE", async () => {
    const jobCard = await createJobCard({ tenantId, transactionId, partyId: customerId, title: "Status test" });
    await completeJobCard(tenantId, jobCard.id);

    const reopened = await setJobCardStatus(tenantId, jobCard.id, "IN_PROGRESS");
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.completedAt).toBeNull();
  });
});

describe("listJobCards", () => {
  it("includes the assigned technician's user record when assigned", async () => {
    const user = await prisma.user.create({ data: { email: `tech-${tenantId}@test.local`, name: "Test Technician" } });
    const membership = await prisma.membership.create({ data: { userId: user.id, tenantId, role: "TECHNICIAN" } });
    await createJobCard({ tenantId, transactionId, partyId: customerId, title: "Assigned job", assignedToId: membership.id });

    const cards = await listJobCards(tenantId);
    const assigned = cards.find((c) => c.title === "Assigned job");
    expect(assigned?.assignedTo?.user.name).toBe("Test Technician");
  });
});
