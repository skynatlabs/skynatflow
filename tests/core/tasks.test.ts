import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { createTask, updateTaskStatus, listTasks } from "../../src/lib/core/tasks";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Task Co", niche: "SERVICES" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("task board", () => {
  it("creates a task defaulting to TODO", async () => {
    const task = await createTask({ tenantId, title: "Call Jane about the quote" });
    expect(task.status).toBe("TODO");
  });

  it("moves a task through statuses", async () => {
    const task = await createTask({ tenantId, title: "Deliver the panels" });
    const inProgress = await updateTaskStatus(tenantId, task.id, "IN_PROGRESS");
    expect(inProgress.status).toBe("IN_PROGRESS");

    const done = await updateTaskStatus(tenantId, task.id, "DONE");
    expect(done.status).toBe("DONE");
  });

  it("lists only this tenant's tasks, ordered by status then due date", async () => {
    const otherTenant = await prisma.tenant.create({
      data: { name: "Other Tenant", niche: "RETAIL" },
    });
    await createTask({ tenantId: otherTenant.id, title: "Not this tenant's task" });
    await createTask({ tenantId, title: "This tenant's task" });

    const tasks = await listTasks(tenantId);
    expect(tasks.every((t) => t.tenantId === tenantId)).toBe(true);
    expect(tasks.some((t) => t.title === "This tenant's task")).toBe(true);

    await prisma.task.deleteMany({ where: { tenantId: otherTenant.id } });
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });

  it("supports assigning a task to a specific membership", async () => {
    const user = await prisma.user.create({ data: { email: "assignee@test.local" } });
    const membership = await prisma.membership.create({
      data: { userId: user.id, tenantId, role: "STAFF" },
    });

    const task = await createTask({
      tenantId,
      title: "Assigned task",
      assigneeId: membership.id,
    });
    expect(task.assigneeId).toBe(membership.id);

    await prisma.membership.delete({ where: { id: membership.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
