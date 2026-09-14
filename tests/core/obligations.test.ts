// The obligation engine. Most of what can go wrong here is arithmetic that
// looks right in Johannesburg and is a day out in London, or a recurrence
// that quietly skips a period at a month boundary — so the date logic is
// tested directly rather than only through the database.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  addObligation,
  advanceRecurrence,
  actionByDate,
  assertNotBlocked,
  blockingObligationsFor,
  completeObligation,
  daysBetween,
  obligationRadar,
  waiveObligation,
  WorkBlockedError,
} from "../../src/lib/core/obligations";


let tenantId: string;
let otherTenantId: string;

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Obligation Test Co", niche: "SERVICES" } });
  tenantId = t.id;
  const o = await prisma.tenant.create({ data: { name: "Other Co", niche: "SERVICES" } });
  otherTenantId = o.id;
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.obligation.deleteMany({ where: { tenantId: id } });
    await prisma.complianceFiling.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

// --------------------------------------------------------------- pure dates

describe("daysBetween — calendar days, not elapsed hours", () => {
  it("counts a date crossing as one day even when only minutes apart", () => {
    // 23:50 and 00:10 the next day are 20 minutes apart but one sleep.
    const a = new Date("2026-03-10T21:50:00Z"); // 23:50 SAST
    const b = new Date("2026-03-10T22:10:00Z"); // 00:10 SAST the 11th
    expect(daysBetween(a, b)).toBe(1);
  });

  it("returns zero for two times on the same local day", () => {
    const a = new Date("2026-03-10T06:00:00Z");
    const b = new Date("2026-03-10T20:00:00Z");
    expect(daysBetween(a, b)).toBe(0);
  });

  it("goes negative for a date already passed", () => {
    expect(daysBetween(new Date("2026-03-10T09:00:00Z"), new Date("2026-03-07T09:00:00Z"))).toBe(-3);
  });
});

describe("advanceRecurrence", () => {
  it("returns null for a one-off", () => {
    expect(advanceRecurrence(new Date("2026-03-01T12:00:00Z"), "NONE")).toBeNull();
  });

  it("adds the right number of months", () => {
    const from = new Date("2026-03-15T12:00:00Z");
    expect(advanceRecurrence(from, "MONTHLY")!.getUTCMonth()).toBe(3); // April
    expect(advanceRecurrence(from, "BIMONTHLY")!.getUTCMonth()).toBe(4); // May
    expect(advanceRecurrence(from, "QUARTERLY")!.getUTCMonth()).toBe(5); // June
    expect(advanceRecurrence(from, "BIANNUAL")!.getUTCMonth()).toBe(8); // September
  });

  it("rolls the year over on an annual obligation", () => {
    const next = advanceRecurrence(new Date("2026-07-01T12:00:00Z"), "ANNUAL")!;
    expect(next.getUTCFullYear()).toBe(2027);
    expect(next.getUTCMonth()).toBe(6);
  });

  it("clamps to the end of a shorter month instead of skipping one", () => {
    // 31 January + 1 month must be 28 February, not 3 March — rolling into
    // March would silently lose a VAT period.
    const next = advanceRecurrence(new Date("2026-01-31T12:00:00Z"), "MONTHLY")!;
    expect(next.getUTCMonth()).toBe(1); // February
    expect(next.getUTCDate()).toBe(28);
  });

  it("handles a leap February", () => {
    const next = advanceRecurrence(new Date("2028-01-31T12:00:00Z"), "MONTHLY")!;
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(29);
  });
});

describe("actionByDate", () => {
  it("is the due date when there is no notice window", () => {
    const due = new Date("2026-06-01T12:00:00Z");
    expect(actionByDate({ dueAt: due, noticeDays: null }).getTime()).toBe(due.getTime());
  });

  it("is earlier than the due date when notice is required", () => {
    // The date that matters on an auto-renewing contract is the last day to
    // give notice, not the renewal date.
    const due = new Date("2026-06-01T12:00:00Z");
    const act = actionByDate({ dueAt: due, noticeDays: 60 });
    expect(act.getTime()).toBeLessThan(due.getTime());
    expect(daysBetween(act, due)).toBe(60);
  });
});

// ------------------------------------------------------------------- radar

describe("obligationRadar", () => {
  it("sorts by when you must act, and names the worst thing in the summary", async () => {
    const now = new Date("2026-06-01T09:00:00Z");

    await addObligation({
      tenantId,
      kind: "LICENCE",
      title: "Trading licence",
      dueAt: new Date("2026-08-01T12:00:00Z"),
      severity: "MEDIUM",
      leadDays: 30,
    });
    await addObligation({
      tenantId,
      kind: "COMPLIANCE_FILING",
      title: "CIPC annual return",
      dueAt: new Date("2026-05-20T12:00:00Z"), // already overdue
      severity: "CRITICAL",
      consequence: "The company gets deregistered and the bank account freezes.",
    });
    await addObligation({
      tenantId,
      kind: "TAX",
      title: "VAT201",
      dueAt: new Date("2026-06-05T12:00:00Z"),
      severity: "HIGH",
      leadDays: 10,
    });

    const radar = await obligationRadar(tenantId, now);

    expect(radar.overdue.map((l) => l.title)).toEqual(["CIPC annual return"]);
    expect(radar.soon.map((l) => l.title)).toEqual(["VAT201"]);
    expect(radar.scheduled.map((l) => l.title)).toEqual(["Trading licence"]);

    // Leads with the named consequence, not a count.
    expect(radar.summary).toContain("CIPC annual return");
    expect(radar.summary).toContain("12 days overdue");
    expect(radar.summary).toContain("bank account freezes");
    expect(radar.summary).toContain("1 other item");
  });

  it("says nothing when there is nothing to say", async () => {
    const quiet = await prisma.tenant.create({ data: { name: "Quiet Co", niche: "SERVICES" } });
    const radar = await obligationRadar(quiet.id, new Date("2026-06-01T09:00:00Z"));
    expect(radar.summary).toBe("");
    expect(radar.overdue).toHaveLength(0);
    await prisma.tenant.delete({ where: { id: quiet.id } });
  });

  it("warns on the notice date, not the renewal date", async () => {
    const now = new Date("2026-06-01T09:00:00Z");
    const t = await prisma.tenant.create({ data: { name: "Notice Co", niche: "SERVICES" } });

    // Renewal is four months out, but notice has to be given within 60 days
    // of it — so by 1 June there are only 62 days to decide.
    await addObligation({
      tenantId: t.id,
      kind: "CONTRACT",
      title: "Cleaning contract",
      dueAt: new Date("2026-10-01T12:00:00Z"),
      noticeDays: 60,
      autoRenews: true,
      leadDays: 45,
    });

    const radar = await obligationRadar(t.id, now);
    const line = [...radar.scheduled, ...radar.soon][0];
    expect(line.daysUntil).toBe(62);
    expect(line.actionByAt.getTime()).toBeLessThan(line.dueAt.getTime());

    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});

// --------------------------------------------------------------- completion

describe("completeObligation", () => {
  it("creates the next occurrence measured from the original due date", async () => {
    const t = await prisma.tenant.create({ data: { name: "Recurring Co", niche: "SERVICES" } });
    const o = await addObligation({
      tenantId: t.id,
      kind: "TAX",
      title: "EMP201",
      dueAt: new Date("2026-03-07T12:00:00Z"),
      recurrence: "MONTHLY",
    });

    // Filed three weeks late. The next one must still be 7 April, not 28
    // April — otherwise one late filing permanently drags the schedule.
    const { next } = await completeObligation({
      tenantId: t.id,
      obligationId: o.id,
      completedAt: new Date("2026-03-28T12:00:00Z"),
    });

    expect(next).not.toBeNull();
    expect(next!.dueAt.getUTCMonth()).toBe(3); // April
    expect(next!.dueAt.getUTCDate()).toBe(7);
    expect(next!.previousId).toBe(o.id);

    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("does not create a successor for a one-off", async () => {
    const t = await prisma.tenant.create({ data: { name: "Oneoff Co", niche: "SERVICES" } });
    const o = await addObligation({
      tenantId: t.id,
      kind: "CERTIFICATE",
      title: "One-time cert",
      dueAt: new Date("2026-03-07T12:00:00Z"),
    });
    const { next } = await completeObligation({ tenantId: t.id, obligationId: o.id });
    expect(next).toBeNull();
    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("still writes the non-profit filing log for a compliance filing", async () => {
    const t = await prisma.tenant.create({ data: { name: "Filing Co", niche: "NONPROFIT" } });
    const o = await addObligation({
      tenantId: t.id,
      kind: "COMPLIANCE_FILING",
      title: "PBO renewal",
      dueAt: new Date("2026-03-07T12:00:00Z"),
    });
    await completeObligation({ tenantId: t.id, obligationId: o.id });

    const filings = await prisma.complianceFiling.findMany({ where: { tenantId: t.id } });
    expect(filings).toHaveLength(1);
    expect(filings[0].filingType).toBe("PBO renewal");

    await prisma.complianceFiling.deleteMany({ where: { tenantId: t.id } });
    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("keeps a waived obligation rather than deleting it", async () => {
    const t = await prisma.tenant.create({ data: { name: "Waive Co", niche: "SERVICES" } });
    const o = await addObligation({
      tenantId: t.id,
      kind: "LICENCE",
      title: "Liquor licence",
      dueAt: new Date("2026-03-07T12:00:00Z"),
    });
    await waiveObligation({ tenantId: t.id, obligationId: o.id, reason: "We don't sell alcohol." });

    const row = await prisma.obligation.findUnique({ where: { id: o.id } });
    expect(row!.status).toBe("WAIVED");
    expect(row!.notes).toContain("don't sell alcohol");

    const radar = await obligationRadar(t.id, new Date("2026-06-01T09:00:00Z"));
    expect(radar.overdue).toHaveLength(0);

    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});

// ---------------------------------------------------------------- guardrail

describe("blocking work", () => {
  it("refuses work on a subject whose blocking obligation has lapsed", async () => {
    const t = await prisma.tenant.create({ data: { name: "Dispatch Co", niche: "LOGISTICS" } });
    const user = await prisma.user.create({
      data: { email: `driver-${t.id}@test.local`, name: "Driver" },
    });
    const m = await prisma.membership.create({
      data: { tenantId: t.id, userId: user.id, role: "DRIVER" },
    });

    await addObligation({
      tenantId: t.id,
      kind: "DOCUMENT",
      title: "Professional driving permit",
      dueAt: new Date("2026-05-01T12:00:00Z"),
      blocksWork: true,
      consequence: "Driving without a valid PDP voids the insurance on the load.",
      membershipId: m.id,
    });

    const now = new Date("2026-06-01T09:00:00Z");
    const blocking = await blockingObligationsFor(t.id, { membershipId: m.id }, now);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].daysOverdue).toBe(31);

    await expect(assertNotBlocked(t.id, { membershipId: m.id }, now)).rejects.toThrow(
      WorkBlockedError
    );
    // The thrown message has to be usable as-is, because it is what the
    // person trying to dispatch actually reads.
    await expect(assertNotBlocked(t.id, { membershipId: m.id }, now)).rejects.toThrow(
      /voids the insurance/
    );

    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.membership.delete({ where: { id: m.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("allows work while the obligation is merely approaching", async () => {
    const t = await prisma.tenant.create({ data: { name: "Fine Co", niche: "LOGISTICS" } });
    const user = await prisma.user.create({
      data: { email: `driver2-${t.id}@test.local`, name: "Driver 2" },
    });
    const m = await prisma.membership.create({
      data: { tenantId: t.id, userId: user.id, role: "DRIVER" },
    });
    await addObligation({
      tenantId: t.id,
      kind: "DOCUMENT",
      title: "PDP",
      dueAt: new Date("2026-07-01T12:00:00Z"),
      blocksWork: true,
      membershipId: m.id,
    });

    await expect(
      assertNotBlocked(t.id, { membershipId: m.id }, new Date("2026-06-01T09:00:00Z"))
    ).resolves.toBeUndefined();

    await prisma.obligation.deleteMany({ where: { tenantId: t.id } });
    await prisma.membership.delete({ where: { id: m.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});

// ------------------------------------------------------------------ tenancy

describe("tenant isolation", () => {
  it("will not complete another workspace's obligation", async () => {
    const o = await addObligation({
      tenantId,
      kind: "LICENCE",
      title: "Isolation probe",
      dueAt: new Date("2026-09-01T12:00:00Z"),
    });
    await expect(
      completeObligation({ tenantId: otherTenantId, obligationId: o.id })
    ).rejects.toThrow(/isn't on your list/);
  });

  it("will not attach an obligation to another workspace's customer", async () => {
    const theirCustomer = await prisma.party.create({
      data: { tenantId: otherTenantId, name: "Their Customer", role: "CUSTOMER" },
    });
    await expect(
      addObligation({
        tenantId,
        kind: "CONTRACT",
        title: "Cross-tenant contract",
        dueAt: new Date("2026-09-01T12:00:00Z"),
        partyId: theirCustomer.id,
      })
    ).rejects.toThrow(/Customer not found/);
  });
});
