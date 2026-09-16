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
  recordRefund,
  totalPaid,
  totalRefunded,
  netPaidByInvoice,
  customerBalance,
  customerBalances,
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
    await sendQuote(quote.id, tenantId);
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

  it("adds up paid less refunded for many invoices at once, the same as one at a time", async () => {
    const make = async () => {
      const q = await createQuote({ tenantId, partyId: customerId, lines: [{ itemId, quantity: 1, unitPriceCents: 100_000 }] });
      await recordResponse(q.id, "ACCEPTED");
      return convertToInvoice({ quoteId: q.id });
    };
    const a = await make();
    const b = await make();
    const untouched = await make();
    await recordPayment({ invoiceId: a.id, amountCents: 60_000 });
    await recordPayment({ invoiceId: a.id, amountCents: 40_000 });
    await recordRefund({ invoiceId: a.id, amountCents: 15_000 });
    await recordPayment({ invoiceId: b.id, amountCents: 25_000 });

    const net = await netPaidByInvoice([a.id, b.id, untouched.id]);
    for (const inv of [a, b, untouched]) {
      expect(net.get(inv.id)).toBe((await totalPaid(inv.id)) - (await totalRefunded(inv.id)));
    }
    expect(net.get(a.id)).toBe(85_000);
    expect(net.get(untouched.id)).toBe(0);
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

  it("gives every customer's balance at once, matching each one's own, and ignores what was cancelled", async () => {
    const other = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Second Customer" } });
    const invoiceFor = async (partyId: string, cents: number) => {
      const q = await createQuote({ tenantId, partyId, lines: [{ itemId, quantity: 1, unitPriceCents: cents }] });
      await recordResponse(q.id, "ACCEPTED");
      return convertToInvoice({ quoteId: q.id });
    };
    const owed = await invoiceFor(other.id, 300_000);
    await recordPayment({ invoiceId: owed.id, amountCents: 120_000 });
    const cancelled = await invoiceFor(other.id, 999_000);
    await prisma.transaction.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });

    const all = await customerBalances(tenantId);
    expect(all.get(other.id)).toBe(180_000);
    expect(all.get(other.id)).toBe(await customerBalance(tenantId, other.id));
    expect(all.get(customerId)).toBe(await customerBalance(tenantId, customerId));
    // Another workspace's customers are never in the list.
    const elsewhere = await prisma.tenant.create({ data: { name: "Elsewhere", niche: "SERVICES" } });
    expect((await customerBalances(elsewhere.id)).size).toBe(0);
    await prisma.tenant.delete({ where: { id: elsewhere.id } });
  });

  it("leaves a draft out of what a customer owes, and puts a refund back on", async () => {
    const draftOnly = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Not Yet Invoiced" } });
    // A draft has never been issued. Nobody has been asked to pay it, so it
    // is not a receivable — on a statement or on the customer's own portal.
    await prisma.transaction.create({
      data: { tenantId, partyId: draftOnly.id, type: "INVOICE", status: "DRAFT", amountCents: 750_000 },
    });
    expect((await customerBalances(tenantId)).get(draftOnly.id)).toBeUndefined();
    expect(await customerBalance(tenantId, draftOnly.id)).toBe(0);

    // A refund is money that went back to them, so it restores the balance —
    // the same arithmetic netPaidByInvoice does.
    const refunded = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Refunded Customer" } });
    const quote = await createQuote({
      tenantId,
      partyId: refunded.id,
      lines: [{ itemId, quantity: 1, unitPriceCents: 200_000 }],
    });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await recordPayment({ invoiceId: invoice.id, amountCents: 200_000 });
    expect(await customerBalance(tenantId, refunded.id)).toBe(0);

    await recordRefund({ invoiceId: invoice.id, amountCents: 50_000 });
    expect(await customerBalance(tenantId, refunded.id)).toBe(50_000);
    expect((await netPaidByInvoice([invoice.id])).get(invoice.id)).toBe(150_000);
  });

  it("flags a sent quote with no response as stale — the leakage-engine query", async () => {
    const quote = await createQuote({
      tenantId,
      partyId: customerId,
      lines: [{ itemId, quantity: 1, unitPriceCents: 500000 }],
    });
    await sendQuote(quote.id, tenantId);
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
