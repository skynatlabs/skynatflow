// Reading a quote out of pasted text.
//
// Money parsing is the part that has to be right. A quote that reads
// "R20 000" as R20.00 is not a bug the customer catches — it is a bug the
// business honours, so every format anyone might paste gets a case here.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  parseMoneyToCents,
  parseLine,
  parseQuoteText,
  composeQuoteFromText,
} from "../../src/lib/core/quoteComposer";

describe("parseMoneyToCents", () => {
  it("reads plain numbers as whole units", () => {
    expect(parseMoneyToCents("2000")).toBe(200_000);
    expect(parseMoneyToCents("1500")).toBe(150_000);
  });

  it("reads South African spacing and comma decimals", () => {
    // The format on every local invoice, and the one a naive parser ruins.
    expect(parseMoneyToCents("R20 000,00")).toBe(2_000_000);
    expect(parseMoneyToCents("R2 000")).toBe(200_000);
    expect(parseMoneyToCents("1 250,50")).toBe(125_050);
  });

  it("reads comma thousands and dot decimals", () => {
    expect(parseMoneyToCents("$1,250.50")).toBe(125_050);
    expect(parseMoneyToCents("2,000.00")).toBe(200_000);
    expect(parseMoneyToCents("2,000")).toBe(200_000);
  });

  it("keeps cents", () => {
    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(parseMoneyToCents("19,9")).toBe(1990);
  });

  it("refuses things that aren't money", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("R")).toBeNull();
  });
});

describe("parseLine", () => {
  it("reads the shape people actually write", () => {
    expect(parseLine("2 x iPhone 16 @ R20 000 each")).toEqual({
      description: "iPhone 16",
      quantity: 2,
      unitPriceCents: 2_000_000,
      raw: "2 x iPhone 16 @ R20 000 each",
    });
  });

  it("handles a dash instead of an at-sign", () => {
    const line = parseLine("1 x AirPods Pro - 4500");
    expect(line?.description).toBe("AirPods Pro");
    expect(line?.quantity).toBe(1);
    expect(line?.unitPriceCents).toBe(450_000);
  });

  it("defaults to one when no quantity is written", () => {
    const line = parseLine("Installation 1500");
    expect(line?.description).toBe("Installation");
    expect(line?.quantity).toBe(1);
    expect(line?.unitPriceCents).toBe(150_000);
  });

  it("does not read a number in the product name as its price", () => {
    // "iPhone 16" ends in a number; the price is the one after the @.
    const line = parseLine("3 x iPhone 16 @ 20000");
    expect(line?.description).toBe("iPhone 16");
    expect(line?.unitPriceCents).toBe(2_000_000);
    expect(line?.quantity).toBe(3);
  });

  it("takes a trailing quantity as the quantity, not the price", () => {
    const line = parseLine("Solar panel x 4 @ 1250");
    expect(line?.description).toBe("Solar panel");
    expect(line?.quantity).toBe(4);
    expect(line?.unitPriceCents).toBe(125_000);
  });

  it("divides an explicit total across the quantity", () => {
    const line = parseLine("4 x battery - 8000 total");
    expect(line?.quantity).toBe(4);
    expect(line?.unitPriceCents).toBe(200_000);
  });

  it("strips bullets and numbering", () => {
    expect(parseLine("- 2 x cable @ 150")?.description).toBe("cable");
    expect(parseLine("1. Mounting kit 899")?.description).toBe("Mounting kit");
  });

  it("refuses contact details and anything unpriced", () => {
    expect(parseLine("isaac@acme.co.za")).toBeNull();
    expect(parseLine("082 555 1234")).toBeNull();
    expect(parseLine("Isaac Dlamini")).toBeNull();
    expect(parseLine("")).toBeNull();
  });
});

describe("parseQuoteText", () => {
  const pasted = [
    "Isaac Dlamini",
    "Acme Trading (Pty) Ltd",
    "isaac@acme.co.za",
    "082 555 1234",
    "",
    "2 x iPhone 16 @ R20 000 each",
    "1 x AirPods Pro - 4500",
    "Installation 1500",
  ].join("\n");

  it("splits the customer off the top from the items below", () => {
    const parsed = parseQuoteText(pasted);
    expect(parsed.customer.name).toBe("Isaac Dlamini");
    expect(parsed.customer.companyName).toBe("Acme Trading (Pty) Ltd");
    expect(parsed.customer.email).toBe("isaac@acme.co.za");
    expect(parsed.customer.phone).toBe("082 555 1234");
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0].unitPriceCents).toBe(2_000_000);
  });

  it("accepts a labelled customer line", () => {
    const parsed = parseQuoteText("For: Jane Smith\njane@x.co\n\n1 x widget 250");
    expect(parsed.customer.name).toBe("Jane Smith");
    expect(parsed.lines).toHaveLength(1);
  });

  it("says what it couldn't price rather than silently dropping it", () => {
    const parsed = parseQuoteText("Jane\n\n2 x widget @ 100\nsomething with no price");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toMatch(/no price/i);
  });

  it("ignores a sign-off after the list", () => {
    const parsed = parseQuoteText("Jane\n\n1 x widget 100\nThanks");
    expect(parsed.warnings).toHaveLength(0);
  });
});

describe("composeQuoteFromText", () => {
  let tenantId: string;
  let existingCustomerId: string;
  let existingItemId: string;

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: "Composer Co", niche: "RETAIL" } });
    tenantId = t.id;
    const p = await prisma.party.create({
      data: {
        tenantId,
        role: PartyRole.CUSTOMER,
        name: "Isaac Dlamini",
        email: "isaac@acme.co.za",
        phone: "+27 82 555 1234",
      },
    });
    existingCustomerId = p.id;
    const i = await prisma.item.create({
      data: { tenantId, name: "iPhone 16", unitPriceCents: 1_900_000 },
    });
    existingItemId = i.id;
  });

  afterAll(async () => {
    await prisma.domainEvent.deleteMany({ where: { tenantId } });
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
    await prisma.transaction.deleteMany({ where: { tenantId } });
    await prisma.item.deleteMany({ where: { tenantId } });
    await prisma.party.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it("builds a draft quote against the customer and products it already has", async () => {
    const result = await composeQuoteFromText({
      tenantId,
      text: "Isaac Dlamini\nisaac@acme.co.za\n\n2 x iPhone 16 @ R20 000 each",
    });

    expect(result.createdCustomer).toBe(false);
    expect(result.customerId).toBe(existingCustomerId);
    expect(result.createdProducts).toEqual([]);
    expect(result.totalCents).toBe(4_000_000);

    const quote = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.quoteId },
      include: { itemLines: true },
    });
    // A draft, always — composing is not sending.
    expect(quote.status).toBe("DRAFT");
    expect(quote.itemLines).toHaveLength(1);
    expect(quote.itemLines[0].itemId).toBe(existingItemId);
    // The pasted price wins over the catalog price: it's what was quoted.
    expect(quote.itemLines[0].unitPriceCents).toBe(2_000_000);
  });

  it("matches an existing customer by phone even when written differently", async () => {
    const result = await composeQuoteFromText({
      tenantId,
      text: "Isaac\n082 555 1234\n\n1 x iPhone 16 @ 19000",
    });
    expect(result.customerId).toBe(existingCustomerId);
    expect(result.createdCustomer).toBe(false);
  });

  it("adds a customer and products the workspace didn't have, and says it did", async () => {
    const result = await composeQuoteFromText({
      tenantId,
      text: "Thandi Nkosi\nthandi@newco.co.za\n\n3 x Solar Panel 450W @ 1250\nInstallation 1500",
    });

    expect(result.createdCustomer).toBe(true);
    expect(result.createdProducts).toEqual(["Solar Panel 450W", "Installation"]);
    expect(result.warnings.join(" ")).toMatch(/added them/i);
    expect(result.totalCents).toBe(3 * 125_000 + 150_000);
  });

  it("refuses rather than guessing when there is nothing priced", async () => {
    await expect(
      composeQuoteFromText({ tenantId, text: "Isaac Dlamini\njust some notes" })
    ).rejects.toThrow(/couldn't find any priced items/i);
  });

  it("refuses when it cannot tell who the quote is for", async () => {
    await expect(
      composeQuoteFromText({ tenantId, text: "2 x iPhone 16 @ 20000" })
    ).rejects.toThrow(/who this is for/i);
  });

  it("refuses a customer belonging to another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Composer", niche: "RETAIL" } });
    const foreign = await prisma.party.create({
      data: { tenantId: other.id, role: PartyRole.CUSTOMER, name: "Theirs" },
    });

    await expect(
      composeQuoteFromText({ tenantId, text: "1 x iPhone 16 @ 20000", customerId: foreign.id })
    ).rejects.toThrow(/not found/i);

    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
