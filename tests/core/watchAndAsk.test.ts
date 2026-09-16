// Noticing, asking, and reading what somebody meant.
//
// All three of these are places where being slightly wrong is expensive in a
// way that does not show up as a bug. A watchlist that cries wolf gets
// switched off; a review request sent to somebody mid-argument produces the
// review nobody wants; and a scheduling cue read silently and wrongly loses a
// job four months later with no trace of why.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { watchlist } from "../../src/lib/core/watchlist";
import { draftReply, reputationHealth, worthAsking } from "../../src/lib/core/reputation";
import { propose, readAndPropose, readCue } from "../../src/lib/core/scheduleTalk";

const DAY = 86_400_000;

let tenantId: string;
let partyId: string;
let supplierId: string;
let membershipId: string;
let userId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Kganya Plumbing", niche: "SERVICES", currency: "ZAR", googleReviewUrl: "https://g.page/r/example" },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `watch-${tenant.id}@example.com`, name: "Thabo" } });
  userId = user.id;
  membershipId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;

  partyId = (await prisma.party.create({ data: { tenantId, name: "Mrs Dlamini", role: "CUSTOMER", email: "d@example.com" } })).id;
  supplierId = (await prisma.party.create({ data: { tenantId, name: "Builders Depot", companyName: "Builders Depot CC", role: "SUPPLIER" } })).id;
});

afterEach(async () => {
  await prisma.expenseLine.deleteMany({ where: { expense: { tenantId } } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.transaction.deleteMany({ where: { tenantId, parentId: { not: null } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

async function cost(amountCents: number, daysAgo: number, overrides: Record<string, unknown> = {}) {
  return prisma.expense.create({
    data: {
      tenantId,
      submittedById: membershipId,
      supplierId,
      descriptionText: "Materials",
      amountCents,
      status: "APPROVED",
      spentOn: new Date(Date.now() - daysAgo * DAY),
      ...overrides,
    },
  });
}

describe("things that look wrong", () => {
  it("says nothing when there is nothing, and says that is a good answer", async () => {
    const result = await watchlist({ tenantId });
    expect(result.findings).toEqual([]);
    expect(result.note).toMatch(/usual answer and it is a good one/i);
  });

  it("notices the same amount to the same supplier twice, a fortnight apart", async () => {
    await cost(450_000, 20);
    await cost(450_000, 6);

    const result = await watchlist({ tenantId });
    const doubled = result.findings.find((finding) => finding.key.startsWith("doubled:"));
    expect(doubled).toBeTruthy();
    // A question with its innocent explanation beside it, never an accusation.
    expect(doubled!.couldBe.length).toBeGreaterThan(10);
    expect(doubled!.what).not.toMatch(/fraud|theft|stolen/i);
    expect(result.stance).toMatch(/question, not an accusation/i);
  });

  it("leaves a monthly bill alone, because flagging it would make the list useless", async () => {
    await cost(120_000, 60);
    await cost(120_000, 30);

    const result = await watchlist({ tenantId });
    expect(result.findings.filter((finding) => finding.key.startsWith("doubled:"))).toEqual([]);
  });

  it("leaves two real invoices alone when their references differ", async () => {
    await cost(80_000, 15, { reference: "INV-100" });
    await cost(80_000, 5, { reference: "INV-211" });

    const result = await watchlist({ tenantId });
    expect(result.findings.filter((finding) => finding.key.startsWith("doubled:"))).toEqual([]);
  });

  it("treats a refund with nothing behind it as urgent", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "REFUND", status: "PAID", amountCents: 90_000, createdAt: new Date(Date.now() - 3 * DAY) },
    });

    const result = await watchlist({ tenantId });
    const finding = result.findings.find((row) => row.key.startsWith("refund-orphan:"))!;
    expect(finding.severity).toBe("urgent");
    expect(finding.what).toMatch(/no invoice behind it/i);
    // Even the urgent one offers the innocent reading.
    expect(finding.couldBe).toMatch(/goodwill/i);
  });

  it("notices a refund bigger than the invoice it is against", async () => {
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "PAID", amountCents: 100_000 },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "REFUND", status: "PAID", amountCents: 250_000, parentId: invoice.id },
    });

    const result = await watchlist({ tenantId });
    expect(result.findings.some((finding) => finding.key.startsWith("refund-over:"))).toBe(true);
  });

  it("notices a supplier price creeping up over several buys", async () => {
    // Four buys of the same thing, the last two 25% dearer.
    for (const [daysAgo, unit] of [[120, 10_000], [100, 10_000], [40, 12_500], [10, 12_500]] as const) {
      const expense = await cost(unit, daysAgo);
      await prisma.expenseLine.create({
        data: { expenseId: expense.id, description: "Copper pipe 15mm", quantity: 1, unitCents: unit, totalCents: unit, sortOrder: 0 },
      });
    }

    const result = await watchlist({ tenantId, sinceDays: 365 });
    const drift = result.findings.find((finding) => finding.key.startsWith("drift:"));
    expect(drift).toBeTruthy();
    expect(drift!.what).toMatch(/costing 25% more/i);
    expect(drift!.couldBe).toMatch(/different size or grade/i);
  });

  it("says nothing about a price bought only twice", async () => {
    for (const [daysAgo, unit] of [[60, 10_000], [10, 20_000]] as const) {
      const expense = await cost(unit, daysAgo);
      await prisma.expenseLine.create({
        data: { expenseId: expense.id, description: "Once-off fitting", quantity: 1, unitCents: unit, totalCents: unit, sortOrder: 0 },
      });
    }
    const result = await watchlist({ tenantId, sinceDays: 365 });
    expect(result.findings.filter((finding) => finding.key.startsWith("drift:"))).toEqual([]);
  });
});

describe("asking for a review", () => {
  async function paidInvoice(daysAgo: number, party = partyId) {
    const invoice = await prisma.transaction.create({
      data: { tenantId, partyId: party, type: "INVOICE", status: "PAID", amountCents: 250_000, createdAt: new Date(Date.now() - (daysAgo + 20) * DAY) },
    });
    await prisma.transaction.create({
      data: { tenantId, partyId: party, type: "PAYMENT", status: "PAID", amountCents: 250_000, parentId: invoice.id, createdAt: new Date(Date.now() - daysAgo * DAY) },
    });
    return invoice;
  }

  it("asks the person who paid this week, and says why them", async () => {
    await paidInvoice(1);
    const result = await worthAsking({ tenantId });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].why).toMatch(/most pleased with you|remember the job/i);
  });

  it("leaves out somebody already asked this quarter", async () => {
    const invoice = await paidInvoice(2);
    await prisma.transaction.update({ where: { id: invoice.id }, data: { reviewRequestSentAt: new Date(Date.now() - 10 * DAY) } });

    const result = await worthAsking({ tenantId });
    expect(result.candidates).toEqual([]);
  });

  it("leaves out somebody with no way to reach them, and says so", async () => {
    const silent = await prisma.party.create({ data: { tenantId, name: "No Contact", role: "CUSTOMER" } });
    await paidInvoice(1, silent.id);

    const result = await worthAsking({ tenantId });
    expect(result.skipped.some((row) => row.why.match(/no way to ask/i))).toBe(true);
  });

  it("answers a one-star review without arguing, and says not to", () => {
    const draft = draftReply({ stars: 1, reviewerName: "Sipho Ndlovu", about: "geyser" });
    expect(draft.text).toMatch(/^Sipho, I am sorry/);
    expect(draft.text).toMatch(/geyser/);
    expect(draft.advice.join(" ")).toMatch(/do not argue the facts in public/i);
  });

  it("keeps a reply to a good review short, and still replies", () => {
    const draft = draftReply({ stars: 5 });
    expect(draft.text.length).toBeLessThan(220);
    expect(draft.advice.join(" ")).toMatch(/reply to good reviews too/i);
  });

  it("refuses to write a review, and says so rather than quietly not doing it", async () => {
    const health = await reputationHealth(tenantId, new Date(Date.now() - 90 * DAY));
    expect(health.advice.join(" ")).toMatch(/drafting the review is fraud/i);
  });

  it("measures the asking rather than the rating", async () => {
    await paidInvoice(3);
    const health = await reputationHealth(tenantId, new Date(Date.now() - 90 * DAY));
    expect(health.paid).toBe(1);
    expect(health.asked).toBe(0);
    expect(health.sharePercent).toBe(0);
    expect(health.hasLink).toBe(true);
  });
});

describe("reading what somebody meant about timing", () => {
  const now = new Date(2026, 5, 10, 14, 0, 0); // Wednesday 10 June 2026

  it("reads a written date day-first, the way it was written", () => {
    const cue = readCue("can you come 14/07", now)!;
    expect(cue.confidence).toBe("exact");
    expect(cue.when.getMonth()).toBe(6);
    expect(cue.when.getDate()).toBe(14);
  });

  it("rolls a date that has already passed into next year", () => {
    const cue = readCue("let's say 03/02", now)!;
    expect(cue.when.getFullYear()).toBe(2027);
    expect(cue.assumption).toMatch(/passed this year/i);
  });

  it("turns a vague phrase into a date and says what it assumed", () => {
    const monthEnd = readCue("call me after month end", now)!;
    expect(monthEnd.when.getMonth()).toBe(6);
    expect(monthEnd.when.getDate()).toBe(1);
    expect(monthEnd.assumption).toMatch(/when the money usually moves/i);

    const holidays = readCue("only after the holidays please", now)!;
    expect(holidays.confidence).toBe("vague");
    expect(holidays.when.getMonth()).toBe(0);
    expect(holidays.assumption).toMatch(/first is usually still quiet/i);
  });

  it("reads a named month as the next one of those", () => {
    const cue = readCue("we'll have budget in July", now)!;
    expect(cue.when.getMonth()).toBe(6);
    expect(cue.when.getFullYear()).toBe(2026);

    const past = readCue("maybe February", now)!;
    expect(past.when.getFullYear()).toBe(2027);
  });

  it("says nothing when the message has no timing in it", () => {
    expect(readCue("thanks, looks good", now)).toBeNull();
    expect(readAndPropose({ text: "thanks, looks good", businessName: "Kganya", now })).toBeNull();
  });

  it("confirms an exact date and asks about a vague one", () => {
    const exact = propose(readCue("14/07", now)!, { businessName: "Kganya" });
    expect(exact.reply).toMatch(/I have put/);
    expect(exact.reply).not.toMatch(/\?/);

    const vague = propose(readCue("sometime in October", now)!, { businessName: "Kganya" });
    // Asking somebody to confirm a date they already gave is irritating;
    // silently accepting "sometime" is how a quote dies.
    expect(vague.reply).toMatch(/\?/);
    expect(vague.thenWhat).toMatch(/unless they say otherwise/i);
  });

  it("never sets a reminder for the middle of the night", () => {
    for (const phrase of ["next week", "in two weeks", "tomorrow"]) {
      const cue = readCue(phrase, now)!;
      expect(cue.when.getHours()).toBe(9);
    }
  });
});
