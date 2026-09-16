// The customer's side.
//
// The properties that matter are the ones a portal in this category usually
// gets wrong: the token is the only credential, so one customer's link must
// never reach another customer's documents; the balance shown has to be the
// balance the business would read off its own statement; and nothing a
// customer sends may change the books on its own — a proof of payment is a
// message to a person, not a payment.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  acceptDetails,
  listSubmissions,
  markSubmissionHandled,
  portalOverview,
  submitDetails,
  submitMessage,
  submitPaymentProof,
} from "../../src/lib/core/portal";

const TOKEN = "jabu-portal-token-0000001";
const OTHER_TOKEN = "thabo-portal-token-000002";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let otherPartyId: string;
let invoiceId: string;
let otherInvoiceId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({
    data: { name: "Ndlovu Logistics", niche: "LOGISTICS", currency: "ZAR", bankAccountNumber: "62012345678", bankName: "FNB" },
  });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const party = await prisma.party.create({
    data: { tenantId, name: "Jabu Traders", role: "CUSTOMER", portalToken: TOKEN, addressLine: "9 Main Road", email: "jabu@example.com" },
  });
  partyId = party.id;
  const otherParty = await prisma.party.create({
    data: { tenantId: otherTenantId, name: "Thabo Stores", role: "CUSTOMER", portalToken: OTHER_TOKEN },
  });
  otherPartyId = otherParty.id;

  // R4 500 invoice, R1 500 paid — R3 000 still owing, and overdue.
  const invoice = await prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: "INVOICE",
      status: "PARTIALLY_PAID",
      amountCents: 450_000,
      dueAt: new Date(Date.now() - 14 * 86_400_000),
    },
  });
  invoiceId = invoice.id;
  await prisma.transaction.create({
    data: { tenantId, partyId, type: "PAYMENT", status: "PAID", amountCents: 150_000, parentId: invoiceId },
  });
  // A draft never shown to the customer, and a quote that is.
  await prisma.transaction.create({ data: { tenantId, partyId, type: "INVOICE", status: "DRAFT", amountCents: 999_900 } });
  await prisma.transaction.create({ data: { tenantId, partyId, type: "QUOTE", status: "SENT", amountCents: 80_000 } });

  const otherInvoice = await prisma.transaction.create({
    data: { tenantId: otherTenantId, partyId: otherPartyId, type: "INVOICE", status: "SENT", amountCents: 20_000 },
  });
  otherInvoiceId = otherInvoice.id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.portalSubmission.deleteMany({ where: { tenantId: id } });
    await prisma.notification.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id, type: { in: ["PAYMENT", "REFUND"] } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("what the customer sees", () => {
  it("shows their balance, what is overdue, and no drafts", async () => {
    const view = await portalOverview(TOKEN);
    expect(view).not.toBeNull();
    expect(view!.party.name).toBe("Jabu Traders");
    expect(view!.business.name).toBe("Ndlovu Logistics");

    // R4 500 invoiced less R1 500 paid. The draft is not in it.
    expect(view!.balanceCents).toBe(300_000);
    expect(view!.overdueCents).toBe(300_000);

    const numbers = view!.documents.map((d) => `${d.kind}:${d.amountCents}`);
    expect(numbers).toContain("INVOICE:450000");
    expect(numbers).toContain("QUOTE:80000");
    expect(numbers).not.toContain("INVOICE:999900");

    const invoice = view!.documents.find((d) => d.id === invoiceId)!;
    expect(invoice.paidCents).toBe(150_000);
    expect(invoice.outstandingCents).toBe(300_000);
  });

  it("gives nothing at all to a token that is not one", async () => {
    expect(await portalOverview("")).toBeNull();
    expect(await portalOverview("short")).toBeNull();
    expect(await portalOverview("a-token-nobody-ever-issued")).toBeNull();
  });

  it("never lets one customer's link reach another's documents", async () => {
    const view = await portalOverview(OTHER_TOKEN);
    expect(view!.documents.map((d) => d.id)).toEqual([otherInvoiceId]);
    expect(view!.documents.map((d) => d.id)).not.toContain(invoiceId);
  });
});

describe("what the customer can send", () => {
  it("takes a proof of payment without touching the books", async () => {
    const before = await portalOverview(TOKEN);
    await submitPaymentProof({ token: TOKEN, transactionId: invoiceId, note: "Paid R3 000 on Tuesday", fileName: "slip.png", fileDataUrl: PIXEL });

    const after = await portalOverview(TOKEN);
    // The whole point: the customer said they paid; nothing has been credited.
    expect(after!.balanceCents).toBe(before!.balanceCents);
    expect(await prisma.transaction.count({ where: { tenantId, type: "PAYMENT" } })).toBe(1);

    const waiting = await listSubmissions(tenantId, { handled: false });
    expect(waiting).toHaveLength(1);
    expect(waiting[0].kind).toBe("payment_proof");
    expect(waiting[0].transactionId).toBe(invoiceId);
    expect(waiting[0].party.name).toBe("Jabu Traders");

    // And somebody at the business was actually told.
    const told = await prisma.notification.findFirst({ where: { tenantId, type: "PAYMENT_PROOF_RECEIVED" } });
    expect(told?.body).toContain("Jabu Traders");
  });

  it("refuses an empty proof, an empty message, and a file that is not one", async () => {
    await expect(submitPaymentProof({ token: TOKEN })).rejects.toThrow(/attach the proof/i);
    await expect(submitMessage({ token: TOKEN, body: "   " })).rejects.toThrow(/nothing in the message/i);
    await expect(
      submitPaymentProof({ token: TOKEN, fileDataUrl: "data:text/html;base64,PHNjcmlwdD4=" })
    ).rejects.toThrow(/photograph or a PDF/i);
  });

  it("drops a document id belonging to somebody else rather than attaching it", async () => {
    await submitMessage({ token: TOKEN, body: "What is this for?", transactionId: otherInvoiceId });
    const [sent] = await listSubmissions(tenantId);
    expect(sent.transactionId).toBeNull();
  });

  it("will not take anything on a link that is not valid", async () => {
    await expect(submitMessage({ token: "not-a-real-token-at-all", body: "hello" })).rejects.toThrow(/not valid/i);
  });
});

describe("the details a customer corrects", () => {
  it("records the change without applying it, then applies it when accepted", async () => {
    await submitDetails({ token: TOKEN, addressLine: "14 Beyers Naude Drive", vatNumber: "4123456789" });

    const stillOld = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
    expect(stillOld.addressLine).toBe("9 Main Road");
    expect(stillOld.vatNumber).toBeNull();

    const [correction] = await listSubmissions(tenantId, { handled: false });
    expect(correction.body).toContain("addressLine: 9 Main Road → 14 Beyers Naude Drive");
    expect(correction.body).toContain("vatNumber: (blank) → 4123456789");

    const applied = await acceptDetails(tenantId, correction.id);
    expect(applied.applied).toBe(2);

    const updated = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
    expect(updated.addressLine).toBe("14 Beyers Naude Drive");
    expect(updated.vatNumber).toBe("4123456789");
    // Accepting it also clears it off the list of things waiting.
    expect(await listSubmissions(tenantId, { handled: false })).toHaveLength(0);
  });

  it("says nothing changed when nothing changed", async () => {
    await expect(submitDetails({ token: TOKEN, name: "Jabu Traders", addressLine: "9 Main Road" })).rejects.toThrow(
      /nothing was changed/i
    );
  });

  it("will not let one workspace close or apply another's", async () => {
    await submitMessage({ token: TOKEN, body: "Where is my delivery?" });
    const [sent] = await listSubmissions(tenantId);
    await expect(markSubmissionHandled(otherTenantId, sent.id)).rejects.toThrow(/not in this workspace/i);
    await expect(acceptDetails(otherTenantId, sent.id)).rejects.toThrow(/not in this workspace/i);
  });
});
