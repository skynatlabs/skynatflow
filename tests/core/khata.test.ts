// The credit book is a capture mode, not a second ledger — so the tests that
// matter are the ones proving it lands in the real one: an entry shows up in
// the customer balance the rest of the app reads, a repayment allocates
// oldest first, and an overpayment is reported rather than quietly parked.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { customerBalances } from "../../src/lib/core/money";
import {
  findOrAddCustomer,
  recordCreditSale,
  recordRepayment,
  theBook,
  customerPage,
  reminderText,
} from "../../src/lib/core/khata";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Khata Test Spaza", niche: "RETAIL" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
});

describe("finding who they mean", () => {
  it("adds somebody who is not there yet", async () => {
    const result = await findOrAddCustomer({ tenantId, name: "Thandi Mokoena", phone: "0721234567" });
    expect(result.created).toBe(true);
    expect(result.name).toBe("Thandi Mokoena");
  });

  it("matches on the number however it was typed, not on the spelling of a name", async () => {
    await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Thandi Mokoena", phone: "+27721234567" },
    });
    const result = await findOrAddCustomer({ tenantId, name: "thandi", phone: "072 123 4567" });
    expect(result.created).toBe(false);
    expect(result.name).toBe("Thandi Mokoena");
  });

  it("falls back to an exact name when there is no number", async () => {
    await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Sipho" } });
    const result = await findOrAddCustomer({ tenantId, name: "  Sipho  " });
    expect(result.created).toBe(false);
  });

  it("refuses an empty name", async () => {
    await expect(findOrAddCustomer({ tenantId, name: "   " })).rejects.toThrow(/who is it for/i);
  });
});

describe("writing it down", () => {
  it("records a credit sale and reports the running balance", async () => {
    const result = await recordCreditSale({
      tenantId,
      customerName: "Thandi",
      phone: "0721234567",
      description: "bread and milk",
      amountCents: 5000,
    });
    expect(result.customerAdded).toBe(true);
    expect(result.balanceCents).toBe(5000);
  });

  it("lands in the balance the rest of the app reads, not a book of its own", async () => {
    const sale = await recordCreditSale({
      tenantId,
      customerName: "Sipho",
      description: "paraffin",
      amountCents: 3000,
    });
    const balances = await customerBalances(tenantId);
    expect(Math.round(balances.get(sale.partyId) ?? 0)).toBe(3000);
  });

  it("keeps the words on the line, not in the catalogue", async () => {
    await recordCreditSale({ tenantId, customerName: "Ayanda", description: "2kg maize meal", amountCents: 4000 });
    await recordCreditSale({ tenantId, customerName: "Ayanda", description: "airtime", amountCents: 1000 });

    // One hidden item for the whole shop, however many entries there are.
    const items = await prisma.item.findMany({ where: { tenantId, name: "Goods on credit" } });
    expect(items).toHaveLength(1);
    expect(items[0].isActive).toBe(false);

    const lines = await prisma.transactionLine.findMany({ where: { transaction: { tenantId } } });
    expect(lines.map((l) => l.description).sort()).toEqual(["2kg maize meal", "airtime"]);
  });

  it("refuses an entry for nothing", async () => {
    await expect(
      recordCreditSale({ tenantId, customerName: "X", description: "air", amountCents: 0 })
    ).rejects.toThrow(/more than nothing/i);
  });

  it("refuses an entry with no description", async () => {
    await expect(
      recordCreditSale({ tenantId, customerName: "X", description: "  ", amountCents: 100 })
    ).rejects.toThrow(/what did they take/i);
  });

  it("refuses a customer from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Someone Else", niche: "RETAIL" } });
    const stranger = await prisma.party.create({
      data: { tenantId: other.id, role: PartyRole.CUSTOMER, name: "Not Yours" },
    });
    await expect(
      recordCreditSale({ tenantId, partyId: stranger.id, description: "bread", amountCents: 100 })
    ).rejects.toThrow(/not found/i);
    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("paying it back", () => {
  let partyId: string;

  beforeEach(async () => {
    const first = await recordCreditSale({
      tenantId,
      customerName: "Thandi",
      description: "bread",
      amountCents: 5000,
    });
    partyId = first.partyId;
    // Force the first entry to be genuinely older so oldest-first is testable.
    await prisma.transaction.updateMany({
      where: { tenantId, partyId },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    await recordCreditSale({ tenantId, partyId, description: "sugar", amountCents: 3000 });
  });

  it("allocates oldest first", async () => {
    const result = await recordRepayment({ tenantId, partyId, amountCents: 5000 });
    expect(result.paidCents).toBe(5000);
    expect(result.balanceCents).toBe(3000);
    expect(result.settled).toHaveLength(1);

    const page = await customerPage(tenantId, partyId);
    const stillOwed = page?.entries.filter((e) => e.kind === "took") ?? [];
    expect(stillOwed).toHaveLength(2);
  });

  it("spills across entries when the payment is bigger than the oldest one", async () => {
    const result = await recordRepayment({ tenantId, partyId, amountCents: 6000 });
    expect(result.paidCents).toBe(6000);
    expect(result.balanceCents).toBe(2000);
    expect(result.settled).toHaveLength(1);
  });

  it("reports an overpayment rather than parking it somewhere invisible", async () => {
    const result = await recordRepayment({ tenantId, partyId, amountCents: 10000 });
    expect(result.paidCents).toBe(8000);
    expect(result.unallocatedCents).toBe(2000);
    expect(result.balanceCents).toBe(0);
  });

  it("refuses a repayment of nothing", async () => {
    await expect(recordRepayment({ tenantId, partyId, amountCents: 0 })).rejects.toThrow(
      /more than nothing/i
    );
  });
});

describe("the book", () => {
  it("says so plainly when nobody owes anything", async () => {
    const book = await theBook(tenantId);
    expect(book.rows).toHaveLength(0);
    expect(book.summary).toMatch(/nobody owes/i);
  });

  it("orders by age, not by amount", async () => {
    const small = await recordCreditSale({
      tenantId,
      customerName: "Old Debt",
      description: "sweets",
      amountCents: 500,
    });
    await prisma.transaction.updateMany({
      where: { tenantId, partyId: small.partyId },
      data: { createdAt: new Date(Date.now() - 120 * 86_400_000) },
    });
    await recordCreditSale({
      tenantId,
      customerName: "Big But New",
      description: "cement",
      amountCents: 90000,
    });

    const book = await theBook(tenantId);
    expect(book.rows[0].name).toBe("Old Debt");
    expect(book.rows[0].oldestDays).toBeGreaterThanOrEqual(119);
  });

  it("separates out what has turned into a loss", async () => {
    const stale = await recordCreditSale({
      tenantId,
      customerName: "Gone Quiet",
      description: "paint",
      amountCents: 20000,
    });
    await prisma.transaction.updateMany({
      where: { tenantId, partyId: stale.partyId },
      data: { createdAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    await recordCreditSale({ tenantId, customerName: "Fresh", description: "nails", amountCents: 1000 });

    const book = await theBook(tenantId);
    expect(book.totalOwedCents).toBe(21000);
    expect(book.goneBadCents).toBe(20000);
    expect(book.summary).toMatch(/two months/i);
  });

  it("drops somebody who has settled", async () => {
    const sale = await recordCreditSale({
      tenantId,
      customerName: "Paid Up",
      description: "rice",
      amountCents: 2000,
    });
    await recordRepayment({ tenantId, partyId: sale.partyId, amountCents: 2000 });
    const book = await theBook(tenantId);
    expect(book.rows).toHaveLength(0);
  });
});

describe("one customer's page", () => {
  it("shows what they took and what they paid, newest first", async () => {
    const sale = await recordCreditSale({
      tenantId,
      customerName: "Thandi",
      description: "bread",
      amountCents: 5000,
    });
    await recordRepayment({ tenantId, partyId: sale.partyId, amountCents: 2000 });

    const page = await customerPage(tenantId, sale.partyId);
    expect(page?.balanceCents).toBe(3000);
    expect(page?.entries[0].kind).toBe("paid");
    expect(page?.entries[1].description).toBe("bread");
  });

  it("returns nothing for somebody who is not in this workspace", async () => {
    expect(await customerPage(tenantId, "nope")).toBeNull();
  });
});

describe("what to send them", () => {
  it("says the number and uses a first name", () => {
    const text = reminderText({
      customerName: "Thandi Mokoena",
      owesCents: 12550,
      oldestDays: 10,
      shopName: "Mama's Corner",
    });
    expect(text).toContain("Hi Thandi,");
    expect(text).toContain("R125.50");
    expect(text).toContain("Mama's Corner");
  });

  it("gets firmer as the debt ages, without threatening anybody", () => {
    const old = reminderText({
      customerName: "Sipho",
      owesCents: 5000,
      oldestDays: 90,
      shopName: "Shop",
    });
    expect(old).toMatch(/over two months ago/);
    expect(old).toMatch(/work something out/);
    expect(old).not.toMatch(/legal|lawyer|court/i);
  });

  it("says nothing about age when the debt is fresh", () => {
    const fresh = reminderText({ customerName: "Ayanda", owesCents: 500, oldestDays: 2, shopName: "Shop" });
    expect(fresh).not.toMatch(/weeks|months/);
  });
});
