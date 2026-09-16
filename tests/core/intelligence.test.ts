// Forecasting, pricing, churn, lead scoring and comparison.
//
// One property matters more than the arithmetic in all of these: an answer
// built on almost nothing must say so. A forecast on four data points
// presented like one on four hundred is how a business orders stock it cannot
// sell and then stops believing the whole product. And a comparison against
// two other businesses is one competitor reading the other's margin.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { ask, asSentence, windowNamed } from "../../src/lib/core/analytics";
import { churnRisk, demandForecast, nextBestActions, priceSignals, scoreOpenQuotes } from "../../src/lib/core/predictions";
import { compare, setBenchmarkOptIn } from "../../src/lib/core/benchmarks";

const DAY = 86_400_000;

let tenantId: string;
let partyId: string;
let itemId: string;

async function invoice(amountCents: number, daysAgo: number, party = partyId) {
  return prisma.transaction.create({
    data: { tenantId, partyId: party, type: "INVOICE", status: "SENT", amountCents, createdAt: new Date(Date.now() - daysAgo * DAY) },
  });
}

async function line(transactionId: string, quantity: number, unitPriceCents: number, discountPercent = 0) {
  return prisma.transactionLine.create({
    data: { transactionId, itemId, quantity, unitPriceCents, discountPercent, sortOrder: 0 },
  });
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Corner Store", niche: "RETAIL", currency: "ZAR" } });
  tenantId = t.id;
  partyId = (await prisma.party.create({ data: { tenantId, name: "Jabu Traders", role: "CUSTOMER", phone: "0821234567" } })).id;
  itemId = (
    await prisma.item.create({ data: { tenantId, name: "Pallet wrap", sku: "PW-1", unitPriceCents: 20_000, costCents: 12_000, stockQty: 10 } })
  ).id;
});

afterEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId, parentId: { not: null } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.jobCard.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("asking the numbers", () => {
  it("answers a question nobody wrote a page for, and says what it counted", async () => {
    const a = await invoice(100_000, 5);
    const b = await invoice(50_000, 40);
    await line(a.id, 2, 20_000);
    await line(b.id, 1, 20_000);

    const month = await ask(tenantId, {
      subject: "invoices",
      measure: "total",
      groupBy: "customer",
      window: windowNamed("last-30-days"),
    });
    expect(month.total).toBe(100_000);
    expect(month.rows[0].label).toBe("Jabu Traders");
    expect(month.basis).toMatch(/drafts and cancellations are not counted/i);
    expect(asSentence(month)).toMatch(/Jabu Traders/);
  });

  it("warns when the answer rests on almost nothing", async () => {
    await invoice(100_000, 2);
    const result = await ask(tenantId, {
      subject: "invoices",
      measure: "total",
      groupBy: "none",
      window: windowNamed("last-30-days"),
    });
    expect(result.caveat).toMatch(/fact about those rather than a pattern/i);
  });

  it("says plainly when there is nothing at all", async () => {
    const result = await ask(tenantId, {
      subject: "costs",
      measure: "total",
      groupBy: "category",
      window: windowNamed("last-30-days"),
    });
    expect(result.total).toBe(0);
    expect(result.caveat).toMatch(/nothing at all/i);
    expect(asSentence(result)).toMatch(/nothing recorded/i);
  });

  it("keeps count, total and average in agreement with each other", async () => {
    const a = await invoice(100_000, 3);
    const b = await invoice(300_000, 4);
    await line(a.id, 1, 100_000);
    await line(b.id, 1, 300_000);

    const spec = { subject: "invoices" as const, groupBy: "none" as const, window: windowNamed("last-30-days") };
    const total = await ask(tenantId, { ...spec, measure: "total" });
    const count = await ask(tenantId, { ...spec, measure: "count" });
    const average = await ask(tenantId, { ...spec, measure: "average" });

    expect(total.total).toBe(400_000);
    expect(count.total).toBe(2);
    expect(average.total).toBe(200_000);
  });

  it("does not count a draft as a sale", async () => {
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "INVOICE", status: "DRAFT", amountCents: 999_900 },
    });
    const result = await ask(tenantId, {
      subject: "invoices",
      measure: "total",
      groupBy: "none",
      window: windowNamed("last-30-days"),
    });
    expect(result.total).toBe(0);
  });
});

describe("what will sell", () => {
  it("works out a rate, days of cover and what to order, and says how sure it is", async () => {
    // Six months of steady selling, ten a month.
    for (let month = 1; month <= 6; month++) {
      const doc = await invoice(200_000, month * 30);
      await line(doc.id, 10, 20_000);
    }

    const [forecast] = await demandForecast(tenantId);
    expect(forecast.name).toBe("Pallet wrap");
    expect(forecast.perMonth).toBeGreaterThan(8);
    expect(forecast.monthsOfHistory).toBeGreaterThanOrEqual(5);
    expect(forecast.confidence).toBe("rough");
    // Ten on hand selling ten a month is about thirty days of cover.
    expect(forecast.daysOfCover).toBeGreaterThan(20);
    expect(forecast.daysOfCover).toBeLessThan(45);
    expect(forecast.orderNow).toBeGreaterThan(0);
  });

  it("calls a single month's history what it is", async () => {
    const doc = await invoice(40_000, 3);
    await line(doc.id, 2, 20_000);
    const [forecast] = await demandForecast(tenantId);
    expect(forecast.confidence).toBe("not-enough");
  });
});

describe("where the price is wrong", () => {
  it("names a line that is never discounted and one that always is", async () => {
    for (let i = 0; i < 9; i++) {
      const doc = await invoice(20_000, i + 1);
      await line(doc.id, 1, 20_000);
    }
    const never = (await priceSignals(tenantId)).find((s) => s.name === "Pallet wrap")!;
    expect(never.discountedShare).toBe(0);
    expect(never.suggestion).toMatch(/never discounted/i);

    const other = await prisma.item.create({
      data: { tenantId, name: "Ratchet strap", unitPriceCents: 10_000, costCents: 6_000 },
    });
    for (let i = 0; i < 6; i++) {
      const doc = await invoice(8_000, i + 1);
      await prisma.transactionLine.create({
        data: { transactionId: doc.id, itemId: other.id, quantity: 1, unitPriceCents: 10_000, discountPercent: 20, sortOrder: 0 },
      });
    }
    const always = (await priceSignals(tenantId)).find((s) => s.name === "Ratchet strap")!;
    expect(always.discountedShare).toBe(100);
    expect(always.suggestion).toMatch(/list price is fiction/i);
  });

  it("says nothing about a line sold once or twice", async () => {
    const doc = await invoice(20_000, 3);
    await line(doc.id, 1, 20_000);
    expect(await priceSignals(tenantId)).toHaveLength(0);
  });
});

describe("who is drifting off", () => {
  it("measures against the customer's own rhythm, not a fixed window", async () => {
    // Orders every seven days, then stops for a month.
    for (const daysAgo of [60, 53, 46, 39]) await invoice(50_000, daysAgo);

    const [risk] = await churnRisk(tenantId);
    expect(risk.customer).toBe("Jabu Traders");
    expect(risk.usualGapDays).toBe(7);
    expect(risk.overdueRatio).toBeGreaterThan(4);
    expect(risk.note).toMatch(/usually orders every 7 days/i);
  });

  it("leaves alone somebody who is not yet past their own pattern", async () => {
    // Orders every ninety days and is sixty days out. Not late for them.
    for (const daysAgo of [240, 150, 60]) await invoice(50_000, daysAgo);
    expect(await churnRisk(tenantId)).toHaveLength(0);
  });

  it("says nothing on two orders, which is a coincidence rather than a rhythm", async () => {
    for (const daysAgo of [200, 190]) await invoice(50_000, daysAgo);
    expect(await churnRisk(tenantId)).toHaveLength(0);
  });
});

describe("which quote to chase", () => {
  it("scores a returning customer who keeps opening it above a stranger who never did", async () => {
    for (let i = 0; i < 3; i++) await invoice(100_000, 100 + i * 10);

    const warm = await prisma.transaction.create({
      data: {
        tenantId,
        partyId,
        type: "QUOTE",
        status: "SENT",
        amountCents: 120_000,
        openCount: 3,
        createdAt: new Date(Date.now() - 5 * DAY),
      },
    });
    const stranger = await prisma.party.create({ data: { tenantId, name: "Nobody Yet", role: "CUSTOMER" } });
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId: stranger.id,
        type: "QUOTE",
        status: "SENT",
        amountCents: 120_000,
        openCount: 0,
        createdAt: new Date(Date.now() - 5 * DAY),
      },
    });

    const scored = await scoreOpenQuotes(tenantId);
    expect(scored[0].transactionId).toBe(warm.id);
    expect(scored[0].reasons.join(" ")).toMatch(/bought 3 times before/i);
    expect(scored[1].reasons.join(" ")).toMatch(/never opened it/i);
  });
});

describe("what to do first", () => {
  it("draws from more than one part of the business and caps the list", async () => {
    for (let i = 0; i < 3; i++) await invoice(100_000, 100 + i * 10);
    await prisma.transaction.create({
      data: { tenantId, partyId, type: "QUOTE", status: "SENT", amountCents: 500_000, openCount: 2, createdAt: new Date(Date.now() - 5 * DAY) },
    });

    const actions = await nextBestActions(tenantId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(6);
    expect(actions[0].why).toMatch(/worth about/i);
  });
});

describe("comparing against others", () => {
  it("shows nothing at all until the business has opted in", async () => {
    const off = await compare(tenantId);
    expect(off.optedIn).toBe(false);
    expect(off.comparisons).toEqual([]);
    expect(off.note).toMatch(/comparisons are off/i);
  });

  it("refuses to report a cohort small enough to identify somebody, and says why", async () => {
    await setBenchmarkOptIn(tenantId, true);
    const doc = await invoice(100_000, 5);
    await line(doc.id, 5, 20_000);

    const on = await compare(tenantId);
    expect(on.optedIn).toBe(true);
    for (const comparison of on.comparisons) {
      expect(comparison.median).toBeNull();
      expect(comparison.note).toMatch(/can be worked out from a number|not enough recorded/i);
    }
    expect(on.note).toMatch(/nothing below 5 contributors/i);
  });
});
