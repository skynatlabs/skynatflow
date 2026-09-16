// The three things a competitor cannot copy by building the same features.
//
// Every one of them is also the easiest thing here to turn into a privacy
// disaster, so most of these tests are about what does *not* happen: a
// workspace that has not opted in is not matched, a partner who has not been
// given access sees nothing, and a request to be forgotten does not quietly
// delete the tax record or quietly refuse.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { breachSurface, DATA_CATEGORIES, pastRetention, processingRecord, subjectRequest } from "../../src/lib/core/dataProtection";
import { COMMISSION, attributeSignup, createPartner, partnerBook, partnerByCode, partnerEarnings } from "../../src/lib/core/partners";
import { findPartners, graphValue, networkShape, setListed } from "../../src/lib/core/tradingGraph";

const DAY = 86_400_000;

let tenantId: string;
let partyId: string;
let userId: string;

beforeEach(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Bokamoso Works", niche: "SERVICES", currency: "ZAR", countryCode: "ZA", vatNumber: "4123456784" },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `moat-${tenant.id}@example.com`, name: "Lerato Dube" } });
  userId = user.id;

  partyId = (
    await prisma.party.create({
      data: {
        tenantId,
        name: "Naledi Trading",
        companyName: "Naledi Trading CC",
        role: "SUPPLIER",
        email: "accounts@naledi.example",
        phone: "0835551234",
        vatNumber: "4987654321",
      },
    })
  ).id;
});

afterEach(async () => {
  await prisma.wholesaleConnection.deleteMany({ where: { OR: [{ supplierTenantId: tenantId }, { buyerTenantId: tenantId }] } });
  await prisma.transaction.deleteMany({ where: { tenantId, parentId: { not: null } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.agreement.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.partner.deleteMany({ where: { ownerUserId: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("what is held about people", () => {
  it("gives every category a reason, a basis and a period", () => {
    for (const category of DATA_CATEGORIES) {
      expect(category.why.length, `${category.what} has no reason`).toBeGreaterThan(10);
      expect(category.retention.length).toBeGreaterThan(10);
    }
    // The one that is only held because somebody said yes has to be marked
    // as such, or the whole record is wrong.
    expect(DATA_CATEGORIES.some((category) => category.basis === "consent")).toBe(true);
    expect(DATA_CATEGORIES.some((category) => category.basis === "legal-obligation")).toBe(true);
  });

  it("names the parts the software cannot do, rather than claiming them", async () => {
    const record = await processingRecord(tenantId);
    expect(record.role).toMatch(/POPIA/);
    expect(record.yourPart.join(" ")).toMatch(/information officer/i);
    expect(record.yourPart.join(" ")).toMatch(/has to be a person/i);
    expect(record.security.length).toBeGreaterThan(2);
  });

  it("answers an access request from what is actually there", async () => {
    await prisma.transaction.create({ data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 100_000 } });

    const request = await subjectRequest({ tenantId, partyId, kind: "access" });
    expect(request.subject).toBe("Naledi Trading CC");
    const documents = request.holding.find((row) => row.what === "Quotes and invoices");
    expect(documents?.count).toBe(1);
    // Thirty days, from when it arrived.
    const days = Math.round((request.answerBy.getTime() - Date.now()) / DAY);
    expect(days).toBe(30);
  });

  it("does not pretend erasure is absolute, and says exactly what survives", async () => {
    const request = await subjectRequest({ tenantId, partyId, kind: "erasure" });
    expect(request.wouldErase.length).toBeGreaterThan(0);
    const remains = request.wouldRemain.map((row) => row.why).join(" ");
    expect(remains).toMatch(/SARS requires five years/i);
    // And the proof that somebody withdrew consent is kept, which is the
    // opposite of obstruction — deleting it would leave no proof they said no.
    expect(remains).toMatch(/no proof they ever said no/i);
    expect(request.note).toMatch(/not absolute/i);
  });

  it("will not answer about somebody in another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Somebody Else", currency: "ZAR" } });
    await expect(subjectRequest({ tenantId: other.id, partyId, kind: "access" })).rejects.toThrow(/not in this workspace/i);
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("can say what a breach would have exposed, and what was never held", async () => {
    const surface = await breachSurface(tenantId);
    expect(surface.people).toBe(1);
    expect(surface.withEmail).toBe(1);
    expect(surface.sentence).toMatch(/would affect 1/);
    expect(surface.notHeld.join(" ")).toMatch(/no card numbers/i);
    expect(surface.duty).toMatch(/Information Regulator/);
  });

  it("finds nothing past its period in a workspace that started yesterday", async () => {
    const result = await pastRetention(tenantId);
    expect(result.total).toBe(0);
    expect(result.note).toMatch(/nothing is being held past/i);
  });
});

describe("the people who bring businesses here", () => {
  it("gives a firm a code that can be said down a phone", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "bookkeeper", contactEmail: "l@dube.example" });
    expect(partner.code).toMatch(/^[0-9A-F]{8}$/);
    expect((await partnerByCode(partner.code.toLowerCase()))?.id).toBe(partner.id);
  });

  it("refuses to attach a code to a workspace that was already here", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "accountant", contactEmail: "l@dube.example" });
    await prisma.tenant.update({ where: { id: tenantId }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });

    // The fraud every referral scheme meets: claiming a business that found
    // the product on its own.
    await expect(attributeSignup({ tenantId, code: partner.code })).rejects.toThrow(/more than a month old/i);
  });

  it("attaches once and refuses a second claim", async () => {
    const first = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "bookkeeper", contactEmail: "l@dube.example" });
    await attributeSignup({ tenantId, code: first.code });
    await expect(attributeSignup({ tenantId, code: first.code })).rejects.toThrow(/already has a partner/i);
  });

  it("shows nothing about a client who has not given access", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "bookkeeper", contactEmail: "l@dube.example" });
    await attributeSignup({ tenantId, code: partner.code });

    const book = await partnerBook(partner.id);
    const client = book.clients.find((row) => row.tenantId === tenantId)!;
    expect(client.hasAccess).toBe(false);
    // There is no partner back door: no attention list, no counts, nothing.
    expect(client.attention).toEqual([]);
    expect(book.note).toMatch(/have not given you access/i);
  });

  it("shows what needs attention once the client adds them as a member", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "bookkeeper", contactEmail: "l@dube.example" });
    await attributeSignup({ tenantId, code: partner.code });
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });

    // Two invoices well past due is the kind of thing a bookkeeper wants
    // flagged before they open the file.
    for (let i = 0; i < 2; i++) {
      await prisma.transaction.create({
        data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 100_000, dueAt: new Date(Date.now() - 90 * DAY) },
      });
    }

    const book = await partnerBook(partner.id);
    const client = book.clients.find((row) => row.tenantId === tenantId)!;
    expect(client.hasAccess).toBe(true);
    expect(client.attention.join(" ")).toMatch(/past due/i);
    expect(book.note).toMatch(/revoke at any time/i);
  });

  it("calls the share a figure rather than a balance", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "reseller", contactEmail: "l@dube.example" });
    await attributeSignup({ tenantId, code: partner.code });
    await prisma.tenant.update({ where: { id: tenantId }, data: { monthlyFeeCents: 50_000 } });

    const earnings = await partnerEarnings(partner.id);
    expect(earnings.clients).toBe(1);
    expect(earnings.monthlyCents).toBe((50_000 * COMMISSION.percent) / 100);
    expect(earnings.caveat).toMatch(/not a balance/i);
  });

  it("stops earning after the window, and says so on the row", async () => {
    const partner = await createPartner({ ownerUserId: userId, firmName: "Dube & Co", kind: "reseller", contactEmail: "l@dube.example" });
    await attributeSignup({ tenantId, code: partner.code });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { monthlyFeeCents: 50_000, createdAt: new Date(Date.now() - 400 * DAY) },
    });

    const earnings = await partnerEarnings(partner.id);
    expect(earnings.monthlyCents).toBe(0);
    expect(earnings.rows[0].note).toMatch(/past the twelve months/i);
  });
});

describe("businesses that already trade with each other", () => {
  async function otherWorkspace(overrides: Record<string, unknown> = {}) {
    return prisma.tenant.create({
      data: { name: "Naledi Trading CC", niche: "WHOLESALE", currency: "ZAR", vatNumber: "4987654321", ...overrides },
    });
  }

  it("does not match a workspace that has not asked to be visible", async () => {
    const other = await otherWorkspace();
    const found = await findPartners(tenantId);
    expect(found.suggestions).toEqual([]);
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("matches once it opts in, and says which record matched and on what", async () => {
    const other = await otherWorkspace({ listedInGraph: true, businessAddress: "1 Market Street, Benoni, 1501" });

    const found = await findPartners(tenantId);
    expect(found.suggestions).toHaveLength(1);
    const [suggestion] = found.suggestions;
    expect(suggestion.listing.name).toBe("Naledi Trading CC");
    expect(suggestion.relationship).toBe("supplier");
    expect(suggestion.because).toMatch(/same VAT number/i);
    expect(suggestion.listing.connected).toBe(false);
    // Nothing is revealed that the asking workspace did not already hold.
    expect(found.note).toMatch(/already have on file/i);

    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("never matches on a name, because two Highway Motors are not one business", async () => {
    // Same trading name, no shared number.
    const other = await prisma.tenant.create({
      data: { name: "Naledi Trading CC", niche: "WHOLESALE", currency: "ZAR", listedInGraph: true },
    });
    const found = await findPartners(tenantId);
    expect(found.suggestions).toEqual([]);
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("says there is nothing to match on rather than silently finding nothing", async () => {
    await prisma.party.update({ where: { id: partyId }, data: { vatNumber: null, registrationNumber: null } });
    const found = await findPartners(tenantId);
    expect(found.note).toMatch(/nothing to match on/i);
    expect(found.note).toMatch(/a name is not enough/i);
  });

  it("can be switched off again without touching existing connections", async () => {
    await setListed(tenantId, true);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { listedInGraph: true } })).listedInGraph).toBe(true);
    await setListed(tenantId, false);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { listedInGraph: true } })).listedInGraph).toBe(false);
  });

  it("states the value as saved effort rather than as a count of nodes", async () => {
    const other = await otherWorkspace({ listedInGraph: true });
    await prisma.wholesaleConnection.create({
      data: { supplierTenantId: other.id, buyerTenantId: tenantId, status: "ACCEPTED" },
    });

    const value = await graphValue(tenantId, new Date(Date.now() - 90 * DAY));
    expect(value.connections).toBe(1);
    expect(value.asBuyer).toBe(1);
    expect(value.sentence).toMatch(/1 where you buy/);
    expect(value.caveat).toMatch(/estimate/i);

    await prisma.wholesaleConnection.deleteMany({ where: { buyerTenantId: tenantId } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("gives the operator counts and no view of who trades with whom", async () => {
    const shape = await networkShape();
    expect(typeof shape.listed).toBe("number");
    expect(shape.note).toMatch(/counts only/i);
    expect(shape.note).toMatch(/nobody should be able to ask for/i);
  });
});
