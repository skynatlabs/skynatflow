// Dispatch, checklists, certificates, job budgets and the offline queue.
//
// Two properties carry most of the weight here. A checklist that can be
// ticked without doing the work is not a checklist, so a photograph-required
// item must refuse a bare tick. And an offline queue that applies something
// twice is worse than no queue at all, so the idempotency key has to hold
// under a phone that retries.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { canWeFitIt, dispatchBoard, orderTheDay, scheduleJob, setJobSite } from "../../src/lib/core/dispatch";
import { attachChecklist, checklistProgress, createChecklist, mayComplete, tickItem } from "../../src/lib/core/checklists";
import { certificateHealth, expiringCertificates, issueCertificate } from "../../src/lib/core/certificates";
import { clockOntoJob, jobBudgets, jobsRunningOver, setJobBudget } from "../../src/lib/core/jobBudget";
import { drainQueue, enqueue, stuckChanges, sync } from "../../src/lib/core/offlineQueue";
import { nextVisitDate } from "../../src/lib/core/maintenance";

const DAY = 86_400_000;

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let membershipId: string;
let invoiceId: string;

async function job(title: string, extra: Record<string, unknown> = {}) {
  return prisma.jobCard.create({
    data: { tenantId, transactionId: invoiceId, partyId, title, ...extra },
  });
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES", currency: "ZAR" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const user = await prisma.user.create({ data: { email: `owner-${t.id}@example.test`, name: "Kagiso" } });
  membershipId = (
    await prisma.membership.create({ data: { tenantId, userId: user.id, role: "OWNER", costRateCents: 30_000 } })
  ).id;

  partyId = (await prisma.party.create({ data: { tenantId, name: "Jabu Ndlovu", role: "CUSTOMER" } })).id;
  invoiceId = (
    await prisma.transaction.create({ data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 500_000 } })
  ).id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.offlineChange.deleteMany({ where: { tenantId: id } });
    await prisma.certificate.deleteMany({ where: { tenantId: id } });
    await prisma.timeEntry.deleteMany({ where: { tenantId: id } });
    await prisma.note.deleteMany({ where: { tenantId: id } });
    await prisma.expense.deleteMany({ where: { tenantId: id } });
    await prisma.jobCardTask.deleteMany({ where: { jobCard: { tenantId: id } } });
    await prisma.jobCard.deleteMany({ where: { tenantId: id } });
    await prisma.checklistItem.deleteMany({ where: { checklist: { tenantId: id } } });
    await prisma.checklist.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    const members = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
    await prisma.membership.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
    for (const m of members) await prisma.user.delete({ where: { id: m.userId } }).catch(() => {});
  }
});

describe("the board", () => {
  it("groups by day, counts the load, and keeps undated work where it can be seen", async () => {
    const tomorrow = new Date(Date.now() + DAY);
    await job("Geyser", { scheduledAt: tomorrow, estimatedMinutes: 120 });
    await job("Leak", { scheduledAt: tomorrow, estimatedMinutes: 60 });
    await job("Quote a bathroom");

    const board = await dispatchBoard({ tenantId, days: 3 });
    const day = board.days.find((d) => d.date === tomorrow.toISOString().slice(0, 10))!;
    expect(day.jobs).toHaveLength(2);
    expect(day.minutesBooked).toBe(180);
    // One person on the workspace, so eight hours available.
    expect(day.minutesAvailable).toBe(480);
    expect(board.unscheduled.map((j) => j.title)).toEqual(["Quote a bathroom"]);
  });

  it("answers whether a day can take another job, and names one that can", async () => {
    const thursday = new Date(Date.now() + 2 * DAY);
    await job("All day", { scheduledAt: thursday, estimatedMinutes: 450 });

    const tight = await canWeFitIt({ tenantId, date: thursday, minutes: 120 });
    expect(tight.fits).toBe(false);
    expect(tight.answer).toMatch(/already booked/i);

    const roomy = await canWeFitIt({ tenantId, date: new Date(Date.now() + 5 * DAY), minutes: 120 });
    expect(roomy.fits).toBe(true);
  });

  it("orders a day so it stops doubling back, and says how much it saved", async () => {
    const day = new Date(Date.now() + DAY);
    // Deliberately worst order: far, near, middle.
    const far = await job("Far", { scheduledAt: day });
    const near = await job("Near", { scheduledAt: day });
    const middle = await job("Middle", { scheduledAt: day });
    await setJobSite({ tenantId, jobCardId: far.id, lat: -26.0, lng: 28.0 });
    await setJobSite({ tenantId, jobCardId: near.id, lat: -26.4, lng: 28.0 });
    await setJobSite({ tenantId, jobCardId: middle.id, lat: -26.2, lng: 28.0 });

    const result = await orderTheDay({ tenantId, date: day });
    expect(result.ordered.map((o) => o.title)).toEqual(["Far", "Middle", "Near"]);
    expect(result.savedKm).toBeGreaterThan(0);
    expect(result.note).toMatch(/km shorter/i);
  });

  it("says plainly when there is not enough to route", async () => {
    const day = new Date(Date.now() + DAY);
    await job("One stop", { scheduledAt: day });
    const result = await orderTheDay({ tenantId, date: day });
    expect(result.savedKm).toBeNull();
    expect(result.note).toMatch(/nothing to reorder|not enough/i);
  });

  it("clears a stale position when a job moves to another day", async () => {
    const day = new Date(Date.now() + DAY);
    const a = await job("A", { scheduledAt: day, routeOrder: 3 });
    await scheduleJob({ tenantId, jobCardId: a.id, scheduledAt: new Date(Date.now() + 3 * DAY) });
    const after = await prisma.jobCard.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.routeOrder).toBeNull();
  });
});

describe("checklists", () => {
  it("refuses a tick on an item that needs a photograph, and blocks completion until it is done", async () => {
    const list = await createChecklist({
      tenantId,
      name: "Geyser replacement",
      items: [{ text: "Water isolated" }, { text: "Photograph the finished work", needsPhoto: true }],
    });
    const j = await job("Geyser");
    await attachChecklist({ tenantId, jobCardId: j.id, checklistId: list.id });

    let verdict = await mayComplete(tenantId, j.id);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/water isolated/i);

    await tickItem({ tenantId, jobCardId: j.id, itemId: list.items[0].id });
    await expect(tickItem({ tenantId, jobCardId: j.id, itemId: list.items[1].id })).rejects.toThrow(/needs a photograph/i);

    await tickItem({ tenantId, jobCardId: j.id, itemId: list.items[1].id, photoUrl: "data:image/png;base64,AAA" });
    verdict = await mayComplete(tenantId, j.id);
    expect(verdict.allowed).toBe(true);

    const progress = await checklistProgress(tenantId, j.id);
    expect(progress!.doneCount).toBe(2);
  });

  it("lets a job through when the checklist is not enforced, and still says what is outstanding", async () => {
    const list = await createChecklist({
      tenantId,
      name: "Tidy up",
      enforced: false,
      items: [{ text: "Sweep" }, { text: "Load the van" }],
    });
    const j = await job("Tidy");
    await attachChecklist({ tenantId, jobCardId: j.id, checklistId: list.id });

    const verdict = await mayComplete(tenantId, j.id);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toMatch(/does not block/i);
  });

  it("says a job with no checklist may be completed", async () => {
    const j = await job("No list");
    expect((await mayComplete(tenantId, j.id)).allowed).toBe(true);
  });
});

describe("certificates", () => {
  it("takes the customer from the job, numbers itself, and works out when it expires", async () => {
    const j = await job("Rewire");
    const cert = await issueCertificate({
      tenantId,
      kind: "coc",
      jobCardId: j.id,
      issuedBy: "Kagiso",
      issuerRef: "EC-12345",
    });

    expect(cert.number).toBe("CERT-0001");
    expect(cert.partyId).toBe(partyId);
    expect(cert.expiresOn).toBeInstanceOf(Date);
    // Two years on a certificate of compliance.
    const months = (cert.expiresOn!.getFullYear() - cert.issuedOn.getFullYear()) * 12 + (cert.expiresOn!.getMonth() - cert.issuedOn.getMonth());
    expect(months).toBe(24);

    const second = await issueCertificate({ tenantId, kind: "test-report", jobCardId: j.id });
    expect(second.number).toBe("CERT-0002");
    // A test report does not expire.
    expect(second.expiresOn).toBeNull();
  });

  it("refuses a certificate of compliance with no registration number on it", async () => {
    const j = await job("Rewire");
    await expect(issueCertificate({ tenantId, kind: "coc", jobCardId: j.id })).rejects.toThrow(/registration number/i);
  });

  it("finds the ones coming up, which are next month's work", async () => {
    const j = await job("Rewire");
    const cert = await issueCertificate({ tenantId, kind: "coc", jobCardId: j.id, issuerRef: "EC-1" });
    await prisma.certificate.update({
      where: { id: cert.id },
      data: { expiresOn: new Date(Date.now() + 30 * DAY) },
    });

    const expiring = await expiringCertificates(tenantId, 90);
    expect(expiring).toHaveLength(1);
    expect(expiring[0].daysLeft).toBeLessThanOrEqual(30);
    expect(expiring[0].expired).toBe(false);

    const health = await certificateHealth(tenantId);
    expect(health.summary).toMatch(/renewal worth selling/i);
  });
});

describe("what a job costs", () => {
  it("counts materials, hours at the person's rate, and the subcontractor separately", async () => {
    const j = await job("Bathroom");
    await setJobBudget({ tenantId, jobCardId: j.id, budgetCents: 200_000 });
    await prisma.expense.create({
      data: { tenantId, submittedById: membershipId, descriptionText: "Tiles", amountCents: 80_000, jobCardId: j.id },
    });

    const entry = await clockOntoJob({ tenantId, membershipId, jobCardId: j.id });
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { clockInAt: new Date(Date.now() - 2 * 3_600_000), clockOutAt: new Date() },
    });

    const [budget] = await jobBudgets(tenantId, { jobCardIds: [j.id] });
    expect(budget.directCents).toBe(80_000);
    // Two hours at R300 an hour.
    expect(budget.labourCents).toBe(60_000);
    expect(budget.spentCents).toBe(140_000);
    expect(budget.usedPercent).toBe(70);
    expect(budget.hoursLogged).toBe(2);
  });

  it("names the jobs near their budget while something can still be done", async () => {
    const j = await job("Overrun");
    await setJobBudget({ tenantId, jobCardId: j.id, budgetCents: 100_000 });
    await prisma.expense.create({
      data: { tenantId, submittedById: membershipId, descriptionText: "Parts", amountCents: 95_000, jobCardId: j.id },
    });

    const over = await jobsRunningOver(tenantId);
    expect(over.jobs).toHaveLength(1);
    expect(over.summary).toMatch(/95%/);
  });

  it("moves somebody clocked on elsewhere rather than counting them twice", async () => {
    const a = await job("First");
    const b = await job("Second");
    await clockOntoJob({ tenantId, membershipId, jobCardId: a.id });
    await clockOntoJob({ tenantId, membershipId, jobCardId: b.id });

    const open = await prisma.timeEntry.findMany({ where: { tenantId, clockOutAt: null } });
    expect(open).toHaveLength(1);
    expect(open[0].jobCardId).toBe(b.id);
  });
});

describe("the offline queue", () => {
  it("applies a change once however many times the phone sends it", async () => {
    const j = await job("On site");
    const change = {
      clientRef: "phone-abc-1",
      kind: "time.clockOn" as const,
      payload: { jobCardId: j.id },
      happenedAt: new Date(Date.now() - 3_600_000).toISOString(),
    };

    const first = await sync({ tenantId, membershipId, changes: [change] });
    expect(first.accepted).toBe(1);
    expect(first.outcomes[0].applied).toBe(true);

    // The phone never saw the response and sends it again.
    const second = await sync({ tenantId, membershipId, changes: [change] });
    expect(second.accepted).toBe(0);
    expect(second.alreadyHad).toBe(1);
    expect(await prisma.timeEntry.count({ where: { tenantId } })).toBe(1);
  });

  it("applies in the order things happened, not the order they arrived", async () => {
    const j = await job("On site");
    const startedAt = new Date(Date.now() - 4 * 3_600_000);
    const finishedAt = new Date(Date.now() - 2 * 3_600_000);

    // Deliberately the wrong way round: clock-off first.
    await sync({
      tenantId,
      membershipId,
      changes: [
        { clientRef: "off", kind: "time.clockOff", payload: {}, happenedAt: finishedAt.toISOString() },
        { clientRef: "on", kind: "time.clockOn", payload: { jobCardId: j.id }, happenedAt: startedAt.toISOString() },
      ],
    });

    const entries = await prisma.timeEntry.findMany({ where: { tenantId } });
    expect(entries).toHaveLength(1);
    // Applied on-then-off, so the shift is two hours rather than negative.
    expect(entries[0].clockOutAt).not.toBeNull();
    const hours = (entries[0].clockOutAt!.getTime() - entries[0].clockInAt.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(2);
  });

  it("keeps what it cannot apply, with the reason, instead of dropping it", async () => {
    await enqueue({
      tenantId,
      membershipId,
      changes: [
        { clientRef: "bad-1", kind: "checklist.tick", payload: { jobCardId: "nope" }, happenedAt: new Date().toISOString() },
      ],
    });
    const outcomes = await drainQueue({ tenantId });
    expect(outcomes[0].applied).toBe(false);

    const stuck = await stuckChanges(tenantId);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].error).toBeTruthy();
  });

  it("does not let one bad change stop the rest of the afternoon", async () => {
    const j = await job("On site");
    const outcomes = (
      await sync({
        tenantId,
        membershipId,
        changes: [
          { clientRef: "bad", kind: "note.add", payload: {}, happenedAt: new Date(Date.now() - 7_200_000).toISOString() },
          { clientRef: "good", kind: "time.clockOn", payload: { jobCardId: j.id }, happenedAt: new Date(Date.now() - 3_600_000).toISOString() },
        ],
      })
    ).outcomes;

    expect(outcomes.find((o) => o.clientRef === "bad")!.applied).toBe(false);
    expect(outcomes.find((o) => o.clientRef === "good")!.applied).toBe(true);
  });
});

describe("maintenance visits", () => {
  it("counts from the start date, so one late month does not push the rest late", () => {
    const startsAt = new Date("2026-01-15T00:00:00Z");
    // Two months in, whatever happened in between.
    const next = nextVisitDate({ startsAt, recurrence: "monthly", after: new Date("2026-03-01T00:00:00Z") });
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-15");

    const quarterly = nextVisitDate({ startsAt, recurrence: "quarterly", after: new Date("2026-05-01T00:00:00Z") });
    expect(quarterly.toISOString().slice(0, 10)).toBe("2026-07-15");
  });
});
