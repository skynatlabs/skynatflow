// Phase 1's Definition of Done, as an actual test: create a tenant, a
// customer, a quote, convert it to an invoice, record a payment, and the
// ledger + customer balance must update correctly and instantly.
//
// Requires DATABASE_URL pointed at a real (test) Postgres instance — see
// the checkpoint note in the project README for what's needed to run this.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import {
  prisma,
  createQuote,
  sendQuote,
  recordResponse,
  convertToInvoice,
  recordPayment,
  customerBalance,
  findStaleTransactions,
  checkUnusualAmount,
} from "../../src/lib/core/money";

let tenantId: string;
let customerId: string;
let itemId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Test Solar Co", niche: "SERVICES" },
  });
  tenantId = tenant.id;

  const customer = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Jane Homeowner", phone: "+27821234567" },
  });
  customerId = customer.id;

  const item = await prisma.item.create({
    data: { tenantId, name: "5kW Solar Install", unitPriceCents: 8500000 },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("quote -> invoice -> payment ledger", () => {
  it("computes quote total from line items", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 8500000 }],
    });
    expect(quote.amountCents).toBe(8500000);
  });

  it("converts an accepted quote to an invoice with matching amount", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 8500000 }],
    });
    await sendQuote(quote.id);
    await recordResponse(quote.id, "ACCEPTED");

    const invoice = await convertToInvoice({ quoteId: quote.id, dueInDays: 14 });
    expect(invoice.amountCents).toBe(quote.amountCents);
    expect(invoice.parentId).toBe(quote.id);
  });

  it("marks invoice PARTIALLY_PAID after a deposit, PAID after the balance", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 8500000 }],
    });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });

    const afterDeposit = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 2000000, // 20% deposit
    });
    expect(afterDeposit.status).toBe("PARTIALLY_PAID");

    const afterFinal = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 6500000, // remaining balance
    });
    expect(afterFinal.status).toBe("PAID");
  });

  it("customer balance reflects only what remains unpaid", async () => {
    const balanceBefore = await customerBalance(tenantId, customerId);

    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 1000000 }],
    });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });

    const balanceAfterInvoice = await customerBalance(tenantId, customerId);
    expect(balanceAfterInvoice).toBe(balanceBefore + 1000000);

    await recordPayment({ invoiceId: invoice.id, amountCents: 1000000 });
    const balanceAfterPayment = await customerBalance(tenantId, customerId);
    expect(balanceAfterPayment).toBe(balanceBefore);
  });

  it("flags a sent quote with no response as stale — the leakage-engine query", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 500000 }],
    });
    await sendQuote(quote.id);
    // backdate createdAt to simulate a quote sent days ago
    await prisma.transaction.update({
      where: { id: quote.id },
      data: { createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });

    const stale = await findStaleTransactions({ tenantId, staleAfterDays: 3 });
    expect(stale.some((t) => t.id === quote.id)).toBe(true);
  });

  it("rejects converting a non-QUOTE transaction to an invoice", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }],
    });
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await expect(convertToInvoice({ quoteId: invoice.id })).rejects.toThrow();
  });

  it("never flags a customer's first-ever document as unusual — nothing to compare against", async () => {
    const freshCustomer = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Brand New Customer" },
    });
    const result = await checkUnusualAmount({ tenantId, partyId: freshCustomer.id, amountCents: 50000000 });
    expect(result).toBeNull();
  });

  it("flags an amount 3x+ a customer's own historical average, not a fixed platform threshold", async () => {
    const regular = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Regular Solar Customer" },
    });
    // Three past quotes averaging 10,000.00 (1,000,000 cents)
    for (const cents of [900000, 1000000, 1100000]) {
      await createQuote({ tenantId, partyId: regular.id, lines: [{ itemId, quantity: 1, unitPriceCents: cents }] });
    }

    const normal = await checkUnusualAmount({ tenantId, partyId: regular.id, amountCents: 1050000 });
    expect(normal?.isUnusual).toBe(false);

    const spike = await checkUnusualAmount({ tenantId, partyId: regular.id, amountCents: 5000000 });
    expect(spike?.isUnusual).toBe(true);
    expect(spike?.multiple).toBeCloseTo(5, 0);
  });

  it("fires the review request the moment an invoice crosses fully into PAID", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { googleReviewUrl: "https://g.page/r/test-review" } });
    const reviewCustomer = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Review Test Customer", phone: "+27821112222" },
    });

    const quote = await createQuote({ tenantId, partyId: reviewCustomer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });

    let updated = await recordPayment({ invoiceId: invoice.id, amountCents: 100000 });
    expect(updated.status).toBe("PAID");

    updated = await prisma.transaction.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.reviewRequestSentAt).not.toBeNull();
  });

  it("never sends a review request while an invoice is only partially paid", async () => {
    const reviewCustomer = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Partial Pay Customer", phone: "+27821113333" },
    });
    const quote = await createQuote({ tenantId, partyId: reviewCustomer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 200000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });

    await recordPayment({ invoiceId: invoice.id, amountCents: 50000 });

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.status).toBe("PARTIALLY_PAID");
    expect(updated.reviewRequestSentAt).toBeNull();
  });
});
