// When a customer says something is wrong.
//
// Two properties. A complaint raised through a portal link can only be
// against that customer's own document — the token is the credential and
// nothing may take a party from the request. And the business is told the
// moment one arrives, because a complaint nobody reads for four days is a
// complaint that has become a phone call.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { disputeHealth, listDisputes, raiseDispute, resolveDispute } from "../../src/lib/core/disputes";

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let otherPartyId: string;
let quoteId: string;
let otherQuoteId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Kagiso Plumbing", niche: "SERVICES" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const party = await prisma.party.create({ data: { tenantId, name: "Jabu Ndlovu", role: "CUSTOMER" } });
  partyId = party.id;
  const otherParty = await prisma.party.create({ data: { tenantId, name: "Thabo Stores", role: "CUSTOMER" } });
  otherPartyId = otherParty.id;

  const quote = await prisma.transaction.create({
    data: { tenantId, partyId, type: "QUOTE", status: "SENT", amountCents: 450_000 },
  });
  quoteId = quote.id;
  const otherQuote = await prisma.transaction.create({
    data: { tenantId, partyId: otherPartyId, type: "QUOTE", status: "SENT", amountCents: 90_000 },
  });
  otherQuoteId = otherQuote.id;
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.dispute.deleteMany({ where: { tenantId: id } });
    await prisma.notification.deleteMany({ where: { tenantId: id } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("raising one", () => {
  it("records it against the document and tells the business at once", async () => {
    await raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "  The second panel is priced twice.  " });

    const [dispute] = await listDisputes(tenantId);
    expect(dispute.message).toBe("The second panel is priced twice.");
    expect(dispute.status).toBe("OPEN");
    expect(dispute.partyName).toBe("Jabu Ndlovu");
    expect(dispute.documentType).toBe("QUOTE");
    expect(dispute.amountCents).toBe(450_000);

    const told = await prisma.notification.findFirstOrThrow({ where: { tenantId } });
    expect(told.title).toContain("Jabu Ndlovu");
    expect(told.body).toContain("priced twice");
  });

  it("refuses an empty message, and another customer's document", async () => {
    await expect(raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "   " })).rejects.toThrow(
      /tell us what is wrong/i
    );
    // Jabu's link, Thabo's quote.
    await expect(
      raiseDispute({ tenantId, transactionId: otherQuoteId, partyId, message: "wrong price" })
    ).rejects.toThrow(/does not belong to this link/i);
  });
});

describe("settling one", () => {
  it("closes it with a note, and can be put back when it was closed too early", async () => {
    const raised = await raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "Wrong price." });

    await resolveDispute({ tenantId, disputeId: raised.id, note: "  Credited the duplicate line.  " });
    let [dispute] = await listDisputes(tenantId);
    expect(dispute.status).toBe("RESOLVED");
    expect(dispute.resolutionNote).toBe("Credited the duplicate line.");
    expect(dispute.resolvedAt).toBeInstanceOf(Date);

    await resolveDispute({ tenantId, disputeId: raised.id, reopen: true });
    [dispute] = await listDisputes(tenantId);
    expect(dispute.status).toBe("OPEN");
    expect(dispute.resolvedAt).toBeNull();
  });

  it("will not settle another workspace's complaint", async () => {
    const raised = await raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "Wrong price." });
    await expect(resolveDispute({ tenantId: otherTenantId, disputeId: raised.id })).rejects.toThrow(
      /not in this workspace/i
    );
  });
});

describe("how well they are answered", () => {
  it("counts what is open and how long the oldest has waited", async () => {
    const now = new Date();
    const old = await raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "Six days ago." });
    await prisma.dispute.update({
      where: { id: old.id },
      data: { createdAt: new Date(now.getTime() - 6 * 86_400_000) },
    });
    const settled = await raiseDispute({ tenantId, transactionId: quoteId, partyId, message: "Sorted." });
    await prisma.dispute.update({
      where: { id: settled.id },
      data: { createdAt: new Date(now.getTime() - 4 * 86_400_000), status: "RESOLVED", resolvedAt: new Date(now.getTime() - 2 * 86_400_000) },
    });

    const health = await disputeHealth(tenantId, now);
    expect(health).toMatchObject({ open: 1, resolved: 1, oldestOpenDays: 6, averageDaysToSettle: 2 });

    // And nothing is claimed on a workspace with none.
    expect(await disputeHealth(otherTenantId, now)).toMatchObject({
      open: 0,
      resolved: 0,
      oldestOpenDays: 0,
      averageDaysToSettle: null,
    });
  });
});
