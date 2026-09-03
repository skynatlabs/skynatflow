// PA job: an automatic, tax-ready donation receipt the instant a
// donation is recorded — see src/lib/core/nonprofit.ts recordDonation.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, InvolvementRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { recordDonation, checkMembershipRenewals, setRenewalDueDate } from "../../src/lib/core/nonprofit";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Nonprofit Co", niche: "NONPROFIT" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.donation.deleteMany({ where: { tenantId } });
  await prisma.membershipInvolvement.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("recordDonation — automatic receipt generation", () => {
  it("auto-generates a sequential receipt number when none is supplied", async () => {
    const donor = await prisma.party.create({ data: { tenantId, role: PartyRole.SPONSOR, name: "First Donor" } });
    const donation = await recordDonation({ tenantId, partyId: donor.id, amountCents: 50000 });
    expect(donation.receiptNumber).toMatch(/^DON-\d{4}-\d{4}$/);
  });

  it("increments the receipt number across donations within the same year", async () => {
    const donor = await prisma.party.create({ data: { tenantId, role: PartyRole.SPONSOR, name: "Second Donor" } });
    const first = await recordDonation({ tenantId, partyId: donor.id, amountCents: 10000 });
    const second = await recordDonation({ tenantId, partyId: donor.id, amountCents: 20000 });

    const firstNum = Number(first.receiptNumber!.split("-")[2]);
    const secondNum = Number(second.receiptNumber!.split("-")[2]);
    expect(secondNum).toBe(firstNum + 1);
  });

  it("respects an explicitly supplied receipt number instead of generating one", async () => {
    const donor = await prisma.party.create({ data: { tenantId, role: PartyRole.SPONSOR, name: "Third Donor" } });
    const donation = await recordDonation({ tenantId, partyId: donor.id, amountCents: 30000, receiptNumber: "CUSTOM-001" });
    expect(donation.receiptNumber).toBe("CUSTOM-001");
  });

  it("never throws when the donor has no email on file — receipt email is best-effort", async () => {
    const donor = await prisma.party.create({ data: { tenantId, role: PartyRole.SPONSOR, name: "No Email Donor" } });
    await expect(recordDonation({ tenantId, partyId: donor.id, amountCents: 15000 })).resolves.toBeDefined();
  });
});

describe("checkMembershipRenewals — chasing a lapsing membership", () => {
  it("flags a membership whose renewal date falls within the window", async () => {
    const member = await prisma.party.create({ data: { tenantId, role: PartyRole.MEMBER, name: "Due Soon Member" } });
    const involvement = await prisma.membershipInvolvement.create({
      data: { tenantId, partyId: member.id, role: InvolvementRole.MEMBER, startDate: new Date() },
    });
    await setRenewalDueDate(tenantId, involvement.id, new Date(Date.now() + 5 * 86400000));

    const due = await checkMembershipRenewals(tenantId, 14);
    expect(due.some((d) => d.involvementId === involvement.id)).toBe(true);
  });

  it("does not flag a membership whose renewal is far in the future", async () => {
    const member = await prisma.party.create({ data: { tenantId, role: PartyRole.MEMBER, name: "Not Due Yet Member" } });
    const involvement = await prisma.membershipInvolvement.create({
      data: { tenantId, partyId: member.id, role: InvolvementRole.MEMBER, startDate: new Date() },
    });
    await setRenewalDueDate(tenantId, involvement.id, new Date(Date.now() + 90 * 86400000));

    const due = await checkMembershipRenewals(tenantId, 14);
    expect(due.some((d) => d.involvementId === involvement.id)).toBe(false);
  });

  it("does not flag a membership that has already ended", async () => {
    const member = await prisma.party.create({ data: { tenantId, role: PartyRole.MEMBER, name: "Ended Member" } });
    const involvement = await prisma.membershipInvolvement.create({
      data: { tenantId, partyId: member.id, role: InvolvementRole.MEMBER, startDate: new Date(), endDate: new Date() },
    });
    await setRenewalDueDate(tenantId, involvement.id, new Date(Date.now() + 5 * 86400000));

    const due = await checkMembershipRenewals(tenantId, 14);
    expect(due.some((d) => d.involvementId === involvement.id)).toBe(false);
  });
});
