// Proving it, timing it, subcontracting it and sequencing it.
//
// Four things that decide whether a service business knows what it made.
// The tests are mostly about refusals: proof that is not a picture, a shift
// with no end that must not become eight hours, a handover with no price, and
// a dependency that would make a plan wait on itself.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { addProof, metresApart, proofPack, undefendedJobs } from "../../src/lib/core/proofOfWork";
import { teamWeek, timesheet } from "../../src/lib/core/timesheets";
import { handOver, subcontractMargins, subcontractorPosition } from "../../src/lib/core/subcontractors";
import { chain, dependsOn } from "../../src/lib/core/jobChain";

const DAY = 86_400_000;
const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

let tenantId: string;
let partyId: string;
let subbieId: string;
let membershipId: string;
let userId: string;

async function jobFor(overrides: Record<string, unknown> = {}) {
  const invoice = await prisma.transaction.create({
    data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 500_000 },
  });
  return prisma.jobCard.create({
    data: { tenantId, partyId, transactionId: invoice.id, title: "Install geyser", status: "SCHEDULED", ...overrides },
  });
}

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Kganya Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `work-${tenant.id}@example.com`, name: "Thabo Nkosi" } });
  userId = user.id;
  membershipId = (await prisma.membership.create({ data: { tenantId, userId, role: "TECHNICIAN", costRateCents: 30_000 } })).id;

  partyId = (await prisma.party.create({ data: { tenantId, name: "Mrs Dlamini", role: "CUSTOMER" } })).id;
  subbieId = (await prisma.party.create({ data: { tenantId, name: "Sipho's Electrical", companyName: "Sipho's Electrical CC", role: "SUPPLIER" } })).id;
});

afterEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.jobCard.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("proving the work was done", () => {
  it("refuses proof that is not a picture", async () => {
    const job = await jobFor();
    await expect(
      addProof({ tenantId, jobCardId: job.id, kind: "after", dataUrl: "we did it, honest" }),
    ).rejects.toThrow(/has to be a picture/i);
  });

  it("calls a pack with only an after photo thin, and says what is missing", async () => {
    const job = await jobFor();
    await addProof({ tenantId, jobCardId: job.id, kind: "after", dataUrl: PIXEL });

    const pack = await proofPack(tenantId, job.id);
    expect(pack!.strength).toBe("partial");
    expect(pack!.missing.join(" ")).toMatch(/before the work started/i);
    expect(pack!.missing.join(" ")).toMatch(/signing for it/i);
  });

  it("calls before, after and a signature strong", async () => {
    const job = await jobFor();
    await addProof({ tenantId, jobCardId: job.id, kind: "before", dataUrl: PIXEL });
    await addProof({ tenantId, jobCardId: job.id, kind: "after", dataUrl: PIXEL });
    await addProof({ tenantId, jobCardId: job.id, kind: "signature", dataUrl: PIXEL });

    const pack = await proofPack(tenantId, job.id);
    expect(pack!.strength).toBe("strong");
    expect(pack!.items).toHaveLength(3);
  });

  it("keeps the moment it was taken, not the moment it arrived", async () => {
    const job = await jobFor();
    const onSite = new Date(Date.now() - 6 * 3600_000);
    await addProof({ tenantId, jobCardId: job.id, kind: "after", dataUrl: PIXEL, at: onSite });

    const pack = await proofPack(tenantId, job.id);
    // A phone out of signal syncs hours later; the first time is the evidence.
    expect(Math.abs(pack!.items[0].at.getTime() - onSite.getTime())).toBeLessThan(2000);
  });

  it("says out loud when a photograph was taken far from the job", async () => {
    const job = await jobFor({ siteLat: -26.19, siteLng: 28.32 });
    // About 20 km away.
    await addProof({ tenantId, jobCardId: job.id, kind: "after", dataUrl: PIXEL, lat: -26.0, lng: 28.32 });

    const pack = await proofPack(tenantId, job.id);
    expect(pack!.standing.join(" ")).toMatch(/more than 500 m/i);
    // And never overclaims what a phone's location proves.
    expect(pack!.standing.join(" ")).toMatch(/good evidence and it is not proof/i);
  });

  it("measures distance the way the earth does", () => {
    // Johannesburg to Pretoria, roughly 50 km.
    const km = metresApart({ lat: -26.2041, lng: 28.0473 }, { lat: -25.7479, lng: 28.2293 }) / 1000;
    expect(km).toBeGreaterThan(45);
    expect(km).toBeLessThan(60);
  });

  it("names the closed jobs nobody could defend", async () => {
    const bare = await jobFor({ status: "DONE", completedAt: new Date(Date.now() - DAY) });
    const good = await jobFor({ status: "DONE", completedAt: new Date(Date.now() - DAY) });
    await addProof({ tenantId, jobCardId: good.id, kind: "after", dataUrl: PIXEL });
    await addProof({ tenantId, jobCardId: good.id, kind: "signature", dataUrl: PIXEL });

    const result = await undefendedJobs(tenantId, new Date(Date.now() - 30 * DAY));
    expect(result.rows.map((row) => row.id)).toContain(bare.id);
    expect(result.rows.map((row) => row.id)).not.toContain(good.id);
    expect(result.note).toMatch(/discounted if anybody pushes/i);
  });
});

describe("the week, per person", () => {
  it("does not turn an unclosed shift into eight hours", async () => {
    const from = new Date(Date.now() - 7 * DAY);
    await prisma.timeEntry.create({ data: { tenantId, membershipId, clockInAt: new Date(Date.now() - 2 * DAY) } });

    const sheet = await timesheet({ tenantId, membershipId, from, to: new Date() });
    expect(sheet.totalMinutes).toBe(0);
    expect(sheet.warnings.join(" ")).toMatch(/never closed/i);
  });

  it("separates hours that reached a customer from hours that did not", async () => {
    const job = await jobFor();
    const from = new Date(Date.now() - 7 * DAY);

    // Four hours on a job, four hours not.
    await prisma.timeEntry.create({
      data: { tenantId, membershipId, jobCardId: job.id, clockInAt: new Date(Date.now() - 2 * DAY), clockOutAt: new Date(Date.now() - 2 * DAY + 4 * 3600_000) },
    });
    await prisma.timeEntry.create({
      data: { tenantId, membershipId, clockInAt: new Date(Date.now() - 1 * DAY), clockOutAt: new Date(Date.now() - 1 * DAY + 4 * 3600_000) },
    });

    const sheet = await timesheet({ tenantId, membershipId, from, to: new Date() });
    expect(sheet.totalMinutes).toBe(480);
    expect(sheet.onJobMinutes).toBe(240);
    expect(sheet.billablePercent).toBe(50);
    // Cost, not pay: eight hours at the recorded cost rate.
    expect(sheet.costCents).toBe(8 * 30_000);
    expect(sheet.jobs.some((row) => row.title === "Not on a job")).toBe(true);
  });

  it("refuses to price hours for somebody with no cost rate, and says so", async () => {
    const other = await prisma.user.create({ data: { email: `norate-${tenantId}@example.com`, name: "Unpriced" } });
    const unpriced = await prisma.membership.create({ data: { tenantId, userId: other.id, role: "STAFF" } });
    await prisma.timeEntry.create({
      data: { tenantId, membershipId: unpriced.id, clockInAt: new Date(Date.now() - DAY), clockOutAt: new Date(Date.now() - DAY + 3600_000) },
    });

    const sheet = await timesheet({ tenantId, membershipId: unpriced.id, from: new Date(Date.now() - 7 * DAY), to: new Date() });
    expect(sheet.costCents).toBeNull();
    expect(sheet.warnings.join(" ")).toMatch(/no cost per hour/i);

    await prisma.timeEntry.deleteMany({ where: { membershipId: unpriced.id } });
    await prisma.membership.delete({ where: { id: unpriced.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("puts the team's worst billable share first, not the longest hours", async () => {
    const job = await jobFor();
    await prisma.timeEntry.create({
      data: { tenantId, membershipId, jobCardId: job.id, clockInAt: new Date(Date.now() - DAY), clockOutAt: new Date(Date.now() - DAY + 8 * 3600_000) },
    });

    const week = await teamWeek({ tenantId, from: new Date(Date.now() - 7 * DAY), to: new Date() });
    expect(week.totalHours).toBe(8);
    expect(week.billablePercent).toBe(100);
    expect(week.note).toMatch(/reached a customer/i);
  });
});

describe("work put out to somebody else", () => {
  it("refuses a handover with no price, which is the whole point", async () => {
    const job = await jobFor();
    await expect(handOver({ tenantId, jobCardId: job.id, subcontractorId: subbieId, agreedCents: 0 })).rejects.toThrow(/without a price/i);
  });

  it("records the price at handover and hands back a link to send them", async () => {
    const job = await jobFor();
    const result = await handOver({ tenantId, jobCardId: job.id, subcontractorId: subbieId, agreedCents: 300_000, scope: "First fix only" });

    expect(result.subcontractor).toBe("Sipho's Electrical CC");
    expect(result.portalUrl).toMatch(/\/portal\//);
    expect(result.note).toMatch(/no second login/i);

    const saved = await prisma.jobCard.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.subcontractCents).toBe(300_000);
    expect(saved.notes).toMatch(/First fix only/);
  });

  it("shows work handed over but not yet invoiced back, which is invisible in the forecast", async () => {
    const job = await jobFor();
    await handOver({ tenantId, jobCardId: job.id, subcontractorId: subbieId, agreedCents: 300_000 });

    const position = await subcontractorPosition(tenantId, new Date(Date.now() - 30 * DAY));
    const [row] = position.rows;
    expect(row.agreedCents).toBe(300_000);
    expect(row.invoicedCents).toBe(0);
    expect(row.outstandingCents).toBe(300_000);
    expect(position.note).toMatch(/none of it is in the cash forecast/i);
  });

  it("flags a subcontractor billing more than was agreed", async () => {
    const job = await jobFor();
    await handOver({ tenantId, jobCardId: job.id, subcontractorId: subbieId, agreedCents: 100_000 });
    await prisma.expense.create({
      data: { tenantId, submittedById: membershipId, supplierId: subbieId, descriptionText: "Electrical", amountCents: 180_000, status: "APPROVED", spentOn: new Date() },
    });

    const position = await subcontractorPosition(tenantId, new Date(Date.now() - 30 * DAY));
    expect(position.rows[0].disagreements.length).toBeGreaterThan(0);
    expect(position.rows[0].disagreements[0].note).toMatch(/more than was agreed/i);
  });

  it("names a job handed over for more than the customer is paying", async () => {
    const job = await jobFor();
    // The invoice is 500,000; handing it over at 600,000 loses money.
    await handOver({ tenantId, jobCardId: job.id, subcontractorId: subbieId, agreedCents: 600_000 });

    const margins = await subcontractMargins(tenantId, new Date(Date.now() - 30 * DAY));
    expect(margins.rows[0].marginCents).toBeLessThan(0);
    expect(margins.rows[0].note).toMatch(/more than the customer is paying/i);
  });
});

describe("what waits on what", () => {
  it("pushes a job's start to when the one before it finishes", async () => {
    const first = await jobFor({ title: "Strip the roof", scheduledAt: new Date(Date.now() + DAY), estimatedMinutes: 480 });
    const second = await jobFor({ title: "Lay the sheeting", scheduledAt: new Date(Date.now() + DAY), estimatedMinutes: 240 });
    await dependsOn({ tenantId, jobCardId: second.id, waitsForId: first.id });

    const result = await chain({ tenantId, days: 30 });
    const one = result.bars.find((bar) => bar.id === first.id)!;
    const two = result.bars.find((bar) => bar.id === second.id)!;

    expect(two.startsAt.getTime()).toBeGreaterThanOrEqual(one.endsAt.getTime());
    // Promised for a day it cannot start on — the thing nobody notices until
    // the customer phones.
    expect(two.problem).toMatch(/cannot start until/i);
    expect(result.warnings.join(" ")).toMatch(/cannot start on/i);
  });

  it("names the chain that decides the finish date", async () => {
    const first = await jobFor({ title: "One", estimatedMinutes: 120 });
    const second = await jobFor({ title: "Two", estimatedMinutes: 120 });
    const loner = await jobFor({ title: "Unrelated", estimatedMinutes: 60 });
    await dependsOn({ tenantId, jobCardId: second.id, waitsForId: first.id });

    const result = await chain({ tenantId, days: 30 });
    expect(result.criticalPath).toContain(first.id);
    expect(result.criticalPath).toContain(second.id);
    expect(result.criticalPath).not.toContain(loner.id);
    expect(result.note).toMatch(/form a chain/i);
    expect(result.finishesAt).not.toBeNull();
  });

  it("refuses a dependency that would make a plan wait on itself", async () => {
    const first = await jobFor({ title: "One" });
    const second = await jobFor({ title: "Two" });
    await dependsOn({ tenantId, jobCardId: second.id, waitsForId: first.id });

    await expect(dependsOn({ tenantId, jobCardId: first.id, waitsForId: second.id })).rejects.toThrow(/make a loop/i);
    await expect(dependsOn({ tenantId, jobCardId: first.id, waitsForId: first.id })).rejects.toThrow(/cannot wait for itself/i);
  });

  it("says when a date rests on a job nobody estimated", async () => {
    await jobFor({ title: "No estimate", estimatedMinutes: null });
    const result = await chain({ tenantId, days: 30 });
    expect(result.warnings.join(" ")).toMatch(/no estimate/i);
    expect(result.bars[0].problem).toMatch(/drawn as two hours/i);
  });

  it("says nothing is open rather than drawing an empty chart", async () => {
    const result = await chain({ tenantId, days: 30 });
    expect(result.bars).toEqual([]);
    expect(result.note).toMatch(/nothing open/i);
  });
});
