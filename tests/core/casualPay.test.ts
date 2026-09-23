// Two rules carry this module and both are about a record somebody can be
// held to: the rate is snapshotted at the moment the work is logged, and
// nothing can be marked paid that was not approved first.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  saveFieldWorker,
  listFieldWorkers,
  logWork,
  approveWork,
  markPaid,
  whatIsOwed,
  casualLabourCost,
  workerHistory,
} from "../../src/lib/core/casualPay";

let tenantId: string;
let workerId: string;
let approverId: string;
let userId: string;

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Casual Pay Test Farm", niche: "SERVICES" } });
  tenantId = tenant.id;
  const user = await prisma.user.create({ data: { email: `foreman-${tenant.id}@example.test`, name: "Foreman" } });
  userId = user.id;
  approverId = (await prisma.membership.create({ data: { tenantId, userId, role: "STAFF" } })).id;
});

afterAll(async () => {
  await prisma.workLog.deleteMany({ where: { tenantId } });
  await prisma.fieldWorker.deleteMany({ where: { tenantId } });
  await prisma.workSite.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.workLog.deleteMany({ where: { tenantId } });
  await prisma.fieldWorker.deleteMany({ where: { tenantId } });
  await prisma.workSite.deleteMany({ where: { tenantId } });
  workerId = (
    await saveFieldWorker({ tenantId, name: "Thabo Mahlangu", phone: "0721234567", rateCents: 18000 })
  ).id;
});

describe("the worker", () => {
  it("is recorded without needing a login or a bank account", async () => {
    const workers = await listFieldWorkers(tenantId);
    expect(workers).toHaveLength(1);
    expect(workers[0].name).toBe("Thabo Mahlangu");
    expect(workers[0].payKind).toBe("DAILY");
  });

  it("refuses a nameless worker", async () => {
    await expect(saveFieldWorker({ tenantId, name: "  " })).rejects.toThrow(/needs a name/i);
  });

  it("updates rather than duplicating", async () => {
    await saveFieldWorker({ tenantId, workerId, name: "Thabo M", rateCents: 20000 });
    const workers = await listFieldWorkers(tenantId);
    expect(workers).toHaveLength(1);
    expect(workers[0].rateCents).toBe(20000);
  });
});

describe("logging work", () => {
  it("prices a day at the worker's rate", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    expect(log.amountCents).toBe(18000);
  });

  it("snapshots the rate, so a raise never rewrites last month", async () => {
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(30), units: 1 });
    await saveFieldWorker({ tenantId, workerId, name: "Thabo Mahlangu", rateCents: 25000 });
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });

    const logs = await prisma.workLog.findMany({ where: { tenantId }, orderBy: { workedOn: "asc" } });
    expect(logs[0].amountCents).toBe(18000);
    expect(logs[1].amountCents).toBe(25000);
  });

  it("takes a one-off rate without changing the worker's standing one", async () => {
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1, rateCents: 30000 });
    const worker = await prisma.fieldWorker.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.rateCents).toBe(18000);
  });

  it("handles piece work", async () => {
    const piece = await saveFieldWorker({
      tenantId,
      name: "Picker",
      payKind: "PIECE",
      rateCents: 450,
    });
    const log = await logWork({ tenantId, fieldWorkerId: piece.id, workedOn: day(1), units: 62 });
    expect(log.amountCents).toBe(27900);
  });

  it("refuses a log for no work", async () => {
    await expect(
      logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 0 })
    ).rejects.toThrow(/some work/i);
  });

  it("records the day worked, not the day typed up", async () => {
    const monday = day(4);
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: monday, units: 1 });
    const log = await prisma.workLog.findFirstOrThrow({ where: { tenantId } });
    expect(Math.abs(log.workedOn.getTime() - monday.getTime())).toBeLessThan(1000);
  });
});

describe("the approval gate", () => {
  it("keeps unapproved work out of what is owed", async () => {
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    const owed = await whatIsOwed(tenantId);
    expect(owed.rows).toHaveLength(0);
    expect(owed.summary).toMatch(/nothing approved/i);
  });

  it("lets approved work through", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    expect(await approveWork({ tenantId, workLogIds: [log.workLogId], approvedById: approverId })).toBe(1);

    const owed = await whatIsOwed(tenantId);
    expect(owed.rows).toHaveLength(1);
    expect(owed.totalCents).toBe(18000);
    expect(owed.rows[0].logIds).toContain(log.workLogId);
  });

  it("cannot be walked around by going straight to paid", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    const result = await markPaid({ tenantId, workLogIds: [log.workLogId] });
    expect(result.marked).toBe(0);
    expect(result.skipped).toBe(1);

    const row = await prisma.workLog.findUniqueOrThrow({ where: { id: log.workLogId } });
    expect(row.status).toBe("LOGGED");
  });

  it("marks approved work paid and takes it off the list", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    await approveWork({ tenantId, workLogIds: [log.workLogId], approvedById: approverId });
    expect((await markPaid({ tenantId, workLogIds: [log.workLogId] })).marked).toBe(1);
    expect((await whatIsOwed(tenantId)).rows).toHaveLength(0);
  });

  it("does not approve the same work twice", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    await approveWork({ tenantId, workLogIds: [log.workLogId], approvedById: approverId });
    expect(await approveWork({ tenantId, workLogIds: [log.workLogId], approvedById: approverId })).toBe(0);
  });

  it("records who approved it", async () => {
    const log = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    await approveWork({ tenantId, workLogIds: [log.workLogId], approvedById: approverId });
    const row = await prisma.workLog.findUniqueOrThrow({ where: { id: log.workLogId } });
    expect(row.approvedById).toBe(approverId);
    expect(row.approvedAt).not.toBeNull();
  });
});

describe("what it cost", () => {
  it("separates what is still waiting for approval", async () => {
    const a = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(2), units: 1 });
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1 });
    await approveWork({ tenantId, workLogIds: [a.workLogId], approvedById: approverId });

    const cost = await casualLabourCost({ tenantId, from: day(30), to: day(-1) });
    expect(cost.amountCents).toBe(36000);
    expect(cost.awaitingApprovalCents).toBe(18000);
    expect(cost.workers).toBe(1);
  });

  it("splits by site, and names work with no site rather than hiding it", async () => {
    const site = await prisma.workSite.create({ data: { tenantId, name: "North block" } });
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(1), units: 1, workSiteId: site.id });
    await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(2), units: 1 });

    const cost = await casualLabourCost({ tenantId, from: day(30), to: day(-1) });
    expect(cost.bySite.map((s) => s.siteName).sort()).toEqual(["No site recorded", "North block"]);
  });
});

describe("one person's record", () => {
  it("is what settles a dispute about being short-paid", async () => {
    const a = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(3), units: 1 });
    const b = await logWork({ tenantId, fieldWorkerId: workerId, workedOn: day(2), units: 1 });
    await approveWork({ tenantId, workLogIds: [a.workLogId, b.workLogId], approvedById: approverId });
    await markPaid({ tenantId, workLogIds: [a.workLogId] });

    const history = await workerHistory(tenantId, workerId);
    expect(history?.logs).toHaveLength(2);
    expect(history?.paidCents).toBe(18000);
    expect(history?.owedCents).toBe(18000);
  });

  it("returns nothing for somebody in another workspace", async () => {
    expect(await workerHistory(tenantId, "nope")).toBeNull();
  });
});
