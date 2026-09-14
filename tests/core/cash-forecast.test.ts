// A cash forecast an owner acts on. The properties that matter are that every
// number traces to a row, that a customer's own payment habit moves the week
// the money lands in, and that what the forecast cannot see is said out loud
// rather than quietly assumed to be zero.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, TransactionType, TransactionStatus } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { buildCashForecast } from "../../src/lib/core/cashForecast";

let tenantId: string;
let promptPayer: string;
let latePayer: string;

const DAY = 86_400_000;
const now = new Date("2026-09-14T09:00:00Z");

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Forecast Co", niche: "SERVICES" } });
  tenantId = t.id;

  const prompt = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Prompt Payer" },
  });
  const late = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Late Payer" },
  });
  promptPayer = prompt.id;
  latePayer = late.id;

  // History: one pays on the day, one is reliably a month late.
  for (let i = 0; i < 3; i++) {
    const due = new Date(now.getTime() - (60 + i * 30) * DAY);
    await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.INVOICE,
        status: TransactionStatus.PAID, amountCents: 100_000,
        dueAt: due, respondedAt: due,
      },
    });
    await prisma.transaction.create({
      data: {
        tenantId, partyId: latePayer, type: TransactionType.INVOICE,
        status: TransactionStatus.PAID, amountCents: 100_000,
        dueAt: due, respondedAt: new Date(due.getTime() + 30 * DAY),
      },
    });
  }
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("shape", () => {
  it("covers thirteen weeks from the start of this one", async () => {
    const forecast = await buildCashForecast({ tenantId, now });
    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.weeks[0].index).toBe(0);
    expect(forecast.weeks[12].index).toBe(12);
    // Monday-based weeks: a business week, not a calendar one.
    expect(new Date(forecast.weeks[0].weekStart + "T00:00:00Z").getUTCDay()).toBe(1);
  });

  it("carries a running balance forward, not per-week islands", async () => {
    const forecast = await buildCashForecast({ tenantId, openingCents: 500_000, now });
    let running = 500_000;
    for (const week of forecast.weeks) {
      running += week.netCents;
      expect(week.closingCents).toBe(running);
    }
  });
});

describe("reading payment habits", () => {
  it("puts a prompt payer's money in the week it's due", async () => {
    const due = new Date(now.getTime() + 10 * DAY);
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.INVOICE,
        status: TransactionStatus.SENT, amountCents: 200_000, dueAt: due,
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    const week = forecast.weeks.find((w) => w.inflows.some((l) => l.label === "Prompt Payer"));

    expect(week).toBeDefined();
    // Due in 10 days, paid on time → lands in week 1 or 2, not later.
    expect(week!.index).toBeLessThanOrEqual(2);

    await prisma.transaction.delete({ where: { id: invoice.id } });
  });

  it("pushes a habitually late payer's money out by their own median", async () => {
    const due = new Date(now.getTime() + 5 * DAY);
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: latePayer, type: TransactionType.INVOICE,
        status: TransactionStatus.SENT, amountCents: 200_000, dueAt: due,
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    const week = forecast.weeks.find((w) => w.inflows.some((l) => l.label === "Late Payer"));

    expect(week).toBeDefined();
    // Due in 5 days but 30 days late by habit → about five weeks out.
    expect(week!.index).toBeGreaterThanOrEqual(4);
    expect(week!.inflows[0].basis).toMatch(/30 days late/);

    await prisma.transaction.delete({ where: { id: invoice.id } });
  });

  it("discounts what it expects, rather than booking the full amount", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: latePayer, type: TransactionType.INVOICE,
        status: TransactionStatus.SENT, amountCents: 1_000_000,
        dueAt: new Date(now.getTime() + 3 * DAY),
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    const line = forecast.weeks.flatMap((w) => w.inflows).find((l) => l.label === "Late Payer");

    // A forecast that books every invoice at face value is a wish list.
    expect(line!.amountCents).toBeLessThan(1_000_000);
    expect(line!.amountCents).toBeGreaterThan(0);

    await prisma.transaction.delete({ where: { id: invoice.id } });
  });

  it("nets off what has already been part-paid", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.INVOICE,
        status: TransactionStatus.PARTIALLY_PAID, amountCents: 1_000_000,
        dueAt: new Date(now.getTime() + 7 * DAY),
      },
    });
    await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.PAYMENT,
        status: TransactionStatus.PAID, amountCents: 800_000, parentId: invoice.id,
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    const line = forecast.weeks.flatMap((w) => w.inflows).find((l) => l.label === "Prompt Payer");

    // R2,000 still owing, not R10,000.
    expect(line!.amountCents).toBeLessThanOrEqual(200_000);

    await prisma.transaction.deleteMany({ where: { parentId: invoice.id } });
    await prisma.transaction.delete({ where: { id: invoice.id } });
  });

  it("treats an overdue invoice as money owed now, not money owed in the past", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.INVOICE,
        status: TransactionStatus.OVERDUE, amountCents: 300_000,
        dueAt: new Date(now.getTime() - 40 * DAY),
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    expect(forecast.weeks[0].inflows.some((l) => l.label === "Prompt Payer")).toBe(true);

    await prisma.transaction.delete({ where: { id: invoice.id } });
  });
});

describe("honesty", () => {
  it("says when running costs are missing instead of looking healthy", async () => {
    const forecast = await buildCashForecast({ tenantId, now });
    expect(forecast.caveats.join(" ")).toMatch(/running costs aren't in this forecast/i);
  });

  it("says when the opening balance is a guess", async () => {
    const forecast = await buildCashForecast({ tenantId, now });
    expect(forecast.caveats.join(" ")).toMatch(/no bank account is connected/i);

    const withBalance = await buildCashForecast({ tenantId, openingCents: 100_000, now });
    expect(withBalance.caveats.join(" ")).not.toMatch(/no bank account is connected/i);
  });

  it("labels every line with a basis and a confidence", async () => {
    const invoice = await prisma.transaction.create({
      data: {
        tenantId, partyId: promptPayer, type: TransactionType.INVOICE,
        status: TransactionStatus.SENT, amountCents: 50_000,
        dueAt: new Date(now.getTime() + 14 * DAY),
      },
    });

    const forecast = await buildCashForecast({ tenantId, now });
    const lines = forecast.weeks.flatMap((w) => [...w.inflows, ...w.outflows]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.basis.length).toBeGreaterThan(5);
      expect(["committed", "likely", "estimated"]).toContain(line.confidence);
    }

    await prisma.transaction.delete({ where: { id: invoice.id } });
  });

  it("finds the week the money runs out", async () => {
    const forecast = await buildCashForecast({ tenantId, openingCents: -1, now });
    expect(forecast.shortfallWeek).toBe(0);
    expect(forecast.lowestCents).toBeLessThanOrEqual(0);
  });
});
