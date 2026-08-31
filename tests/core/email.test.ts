// PA job: "any important mail?" / "what did [customer] email about?" —
// see src/lib/core/email.ts getRecentEmailsForPa. Also covers the
// payment-chasing loop: a PAYMENT_REPLY with a date reschedules the
// follow-up, one without a date gets a "please give us a date" reply
// queued, and a payment-proof claim alerts the owner — never auto-marks
// paid, that stays a human decision. classifyInboundEmail is mocked here
// since there's no AI key in local dev to exercise its real behavior.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";

const mockClassify = vi.fn();
vi.mock("@/lib/ai/emailClassifier", () => ({
  classifyInboundEmail: (...args: unknown[]) => mockClassify(...args),
}));

const { getRecentEmailsForPa, ingestEmail } = await import("../../src/lib/core/email");
const { createQuote, recordResponse, convertToInvoice } = await import("../../src/lib/core/money");

let tenantId: string;
let emailAccountId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Mail Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const account = await prisma.emailAccount.create({
    data: { tenantId, provider: "FLOW_HOSTED", emailAddress: "test@mail.flow.skynat.co" },
  });
  emailAccountId = account.id;
});

afterAll(async () => {
  await prisma.inboundEmail.deleteMany({ where: { tenantId } });
  await prisma.aiDraft.deleteMany({ where: { tenantId } });
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.emailAccount.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("getRecentEmailsForPa", () => {
  it("resolves a sender's email address to their name on file", async () => {
    await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Known Client Co", email: "known@client.test" } });
    await prisma.inboundEmail.create({
      data: {
        tenantId, emailAccountId, fromAddress: "known@client.test", subject: "About the quote",
        bodyText: "...", receivedAt: new Date(), category: "QUOTE_REPLY", isImportant: true, aiSummary: "Wants to proceed next month.",
      },
    });

    const emails = await getRecentEmailsForPa(tenantId);
    expect(emails[0].fromLabel).toBe("Known Client Co");
    expect(emails[0].summary).toBe("Wants to proceed next month.");
  });

  it("falls back to the raw address when the sender isn't a known party", async () => {
    await prisma.inboundEmail.create({
      data: {
        tenantId, emailAccountId, fromAddress: "stranger@nowhere.test", subject: "Random",
        bodyText: "...", receivedAt: new Date(), category: "OTHER", isImportant: false,
      },
    });

    const emails = await getRecentEmailsForPa(tenantId);
    const strangerEmail = emails.find((e) => e.subject === "Random");
    expect(strangerEmail?.fromLabel).toBe("stranger@nowhere.test");
  });

  it("sorts important emails ahead of merely-recent ones", async () => {
    const older = new Date(Date.now() - 5 * 86400000);
    await prisma.inboundEmail.create({
      data: {
        tenantId, emailAccountId, fromAddress: "urgent@legal.test", subject: "Legal notice",
        bodyText: "...", receivedAt: older, category: "LEGAL", isImportant: true, aiSummary: "Needs a response.",
      },
    });

    const emails = await getRecentEmailsForPa(tenantId);
    expect(emails[0].isImportant).toBe(true);
  });

  it("returns an empty array when no emails have come in", async () => {
    const emptyTenant = await prisma.tenant.create({ data: { name: "No Mail Co", niche: "SERVICES" } });
    const emails = await getRecentEmailsForPa(emptyTenant.id);
    expect(emails).toEqual([]);
    await prisma.tenant.delete({ where: { id: emptyTenant.id } });
  });
});

describe("ingestEmail — payment-chasing loop", () => {
  let itemId: string;

  beforeAll(async () => {
    const item = await prisma.item.create({ data: { tenantId, name: "Payment Test Widget", unitPriceCents: 100000 } });
    itemId = item.id;
  });

  it("reschedules the invoice's follow-up when the customer gives a specific date", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Firm Date Customer", email: "firmdate@test.local" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await prisma.transaction.update({ where: { id: invoice.id }, data: { status: "SENT" } });

    mockClassify.mockResolvedValueOnce({
      category: "PAYMENT_REPLY", isImportant: true, summary: "Will pay in 5 days.",
      scheduleFollowUpInDays: 5, looksLikePaymentProof: false,
    });

    await ingestEmail({ tenantId, emailAccountId, fromAddress: "firmdate@test.local", subject: "Re: invoice", bodyText: "I'll pay in 5 days", receivedAt: new Date() });

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.nextFollowUpAt).not.toBeNull();
    expect(updated.nextFollowUpAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 86400000);
  });

  it("queues a PENDING ask-for-a-date draft when the promise has no firm date and auto-respond is off", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Vague Promise Customer", email: "vague@test.local" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await prisma.transaction.update({ where: { id: invoice.id }, data: { status: "SENT" } });

    mockClassify.mockResolvedValueOnce({
      category: "PAYMENT_REPLY", isImportant: true, summary: "Says they'll pay soon.",
      scheduleFollowUpInDays: null, looksLikePaymentProof: false,
    });

    await ingestEmail({ tenantId, emailAccountId, fromAddress: "vague@test.local", subject: "Re: invoice", bodyText: "Will pay soon", receivedAt: new Date() });

    const draft = await prisma.aiDraft.findFirst({ where: { transactionId: invoice.id } });
    expect(draft?.status).toBe("PENDING");
    expect(draft?.body.toLowerCase()).toContain("date");
  });

  it("sends the ask-for-a-date reply immediately when the tenant has auto-respond enabled", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { autoRespondEnabled: true } });
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Auto Respond Customer", email: "autoreply@test.local" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await prisma.transaction.update({ where: { id: invoice.id }, data: { status: "SENT" } });

    mockClassify.mockResolvedValueOnce({
      category: "PAYMENT_REPLY", isImportant: true, summary: "Says they'll pay soon.",
      scheduleFollowUpInDays: null, looksLikePaymentProof: false,
    });

    await ingestEmail({ tenantId, emailAccountId, fromAddress: "autoreply@test.local", subject: "Re: invoice", bodyText: "Will pay soon", receivedAt: new Date() });

    const draft = await prisma.aiDraft.findFirst({ where: { transactionId: invoice.id } });
    expect(draft?.status).toBe("SENT");
    await prisma.tenant.update({ where: { id: tenantId }, data: { autoRespondEnabled: false } });
  });

  it("alerts the owner on a payment-proof claim without ever auto-marking the invoice paid", async () => {
    const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Proof Sender Customer", email: "proof@test.local" } });
    const quote = await createQuote({ tenantId, partyId: customer.id, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }] });
    await recordResponse(quote.id, "ACCEPTED");
    const invoice = await convertToInvoice({ quoteId: quote.id });
    await prisma.transaction.update({ where: { id: invoice.id }, data: { status: "SENT" } });

    mockClassify.mockResolvedValueOnce({
      category: "PAYMENT_REPLY", isImportant: true, summary: "Says they've already paid, references EFT proof.",
      scheduleFollowUpInDays: null, looksLikePaymentProof: true,
    });

    await ingestEmail({ tenantId, emailAccountId, fromAddress: "proof@test.local", subject: "Payment made", bodyText: "Here's my proof of payment", receivedAt: new Date() });

    const notification = await prisma.notification.findFirst({ where: { tenantId, type: "PAYMENT_PROOF_RECEIVED" } });
    expect(notification).not.toBeNull();
    expect(notification?.linkHref).toBe(`/dashboard/${tenantId}/invoices/${invoice.id}`);

    const unchangedInvoice = await prisma.transaction.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchangedInvoice.status).toBe("SENT"); // never auto-marked paid
  });
});
