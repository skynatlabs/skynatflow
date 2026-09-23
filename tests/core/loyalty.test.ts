// Points are a liability, so the tests that matter are the ones about not
// owing more than you meant to: the walk-in record never accrues, a basket
// too small to earn a point earns nothing rather than rounding up, and the
// balance can always be rebuilt from the entries behind it.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  saveLoyaltyProgram,
  getLoyaltyProgram,
  enrolMember,
  earnOnSale,
  redeemPoints,
  adjustPoints,
  findMemberByPhone,
  topMembers,
  lapsedMembers,
  loyaltySummary,
  memberHistory,
  expireStalePoints,
} from "../../src/lib/core/loyalty";

let tenantId: string;
let customerId: string;
let walkInId: string;
let noPhoneId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Loyalty Test Shop", niche: "RETAIL" } });
  tenantId = tenant.id;

  const customer = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Thandi Mokoena", phone: "+27721234567" },
  });
  customerId = customer.id;

  const walkIn = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Walk-in customer" },
  });
  walkInId = walkIn.id;

  const noPhone = await prisma.party.create({
    data: { tenantId, role: PartyRole.CUSTOMER, name: "Cash Only Carl" },
  });
  noPhoneId = noPhone.id;
});

afterAll(async () => {
  await prisma.loyaltyEntry.deleteMany({ where: { tenantId } });
  await prisma.loyaltyAccount.deleteMany({ where: { tenantId } });
  await prisma.loyaltyProgram.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.loyaltyEntry.deleteMany({ where: { tenantId } });
  await prisma.loyaltyAccount.deleteMany({ where: { tenantId } });
  await prisma.loyaltyProgram.deleteMany({ where: { tenantId } });
});

describe("the programme", () => {
  it("does not exist until somebody sets it up", async () => {
    expect(await getLoyaltyProgram(tenantId)).toBeNull();
  });

  it("refuses a redeem rate of zero, which would make points worthless", async () => {
    const saved = await saveLoyaltyProgram(tenantId, { redeemCentsPerPoint: 0 });
    expect(saved.redeemCentsPerPoint).toBe(1);
  });

  it("will not expire points faster than a month", async () => {
    const saved = await saveLoyaltyProgram(tenantId, { expireAfterDays: 3 });
    expect(saved.expireAfterDays).toBe(30);
  });

  it("keeps never-expire as a real option", async () => {
    const saved = await saveLoyaltyProgram(tenantId, { expireAfterDays: null });
    expect(saved.expireAfterDays).toBeNull();
  });
});

describe("earning", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, { earnPointsPerUnit: 1, redeemCentsPerPoint: 10, minRedeemPoints: 50 });
  });

  it("enrols a phone-reachable customer automatically on their first sale", async () => {
    const result = await earnOnSale({ tenantId, partyId: customerId, amountCents: 25000 });
    expect(result.enrolled).toBe(true);
    expect(result.pointsEarned).toBe(250);
    expect(result.balance).toBe(250);
  });

  it("never credits the shared walk-in record", async () => {
    const result = await earnOnSale({ tenantId, partyId: walkInId, amountCents: 50000 });
    expect(result.pointsEarned).toBe(0);
    expect(result.reason).toMatch(/anonymous/i);
    expect(await prisma.loyaltyAccount.count({ where: { tenantId } })).toBe(0);
  });

  it("does not auto-enrol somebody with no number, because nothing could reach them", async () => {
    const result = await earnOnSale({ tenantId, partyId: noPhoneId, amountCents: 50000 });
    expect(result.pointsEarned).toBe(0);
    expect(result.reason).toMatch(/phone/i);
  });

  it("floors rather than rounds, so the business never owes more than the spend justifies", async () => {
    // R14.99 at one point per rand is fourteen points, not fifteen.
    const result = await earnOnSale({ tenantId, partyId: customerId, amountCents: 1499 });
    expect(result.pointsEarned).toBe(14);
  });

  it("earns nothing at all on a basket too small for one point", async () => {
    const result = await earnOnSale({ tenantId, partyId: customerId, amountCents: 60 });
    expect(result.pointsEarned).toBe(0);
    expect(result.reason).toMatch(/too small/i);
  });

  it("stays quiet rather than throwing when there is no programme", async () => {
    await prisma.loyaltyProgram.deleteMany({ where: { tenantId } });
    const result = await earnOnSale({ tenantId, partyId: customerId, amountCents: 10000 });
    expect(result.pointsEarned).toBe(0);
    expect(result.reason).toMatch(/no active/i);
  });

  it("accumulates lifetime spend across sales", async () => {
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 10000 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 5000 });
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { tenantId_partyId: { tenantId, partyId: customerId } },
    });
    expect(account.lifetimeSpendCents).toBe(15000);
    expect(account.pointsBalance).toBe(150);
  });
});

describe("the balance can always be rebuilt from the entries", () => {
  it("sums the signed entries to exactly the stored balance", async () => {
    await saveLoyaltyProgram(tenantId, { earnPointsPerUnit: 2, minRedeemPoints: 10 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 30000 }); // +600
    await redeemPoints({ tenantId, partyId: customerId, points: 100 }); // -100
    await adjustPoints({ tenantId, partyId: customerId, points: 25, note: "Goodwill after a wrong order" });

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { tenantId_partyId: { tenantId, partyId: customerId } },
    });
    const entries = await prisma.loyaltyEntry.findMany({ where: { accountId: account.id } });
    const summed = entries.reduce((total, e) => total + e.points, 0);

    expect(summed).toBe(account.pointsBalance);
    expect(account.pointsBalance).toBe(525);
  });
});

describe("redeeming", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, { earnPointsPerUnit: 1, redeemCentsPerPoint: 10, minRedeemPoints: 50 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 20000 }); // 200 points
  });

  it("returns a discount without touching what the customer owes", async () => {
    const result = await redeemPoints({ tenantId, partyId: customerId, points: 100 });
    expect(result.ok).toBe(true);
    expect(result.discountCents).toBe(1000);
    expect(result.balance).toBe(100);
  });

  it("refuses below the floor", async () => {
    const result = await redeemPoints({ tenantId, partyId: customerId, points: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/smallest redemption is 50/i);
  });

  it("refuses more than they have, and says how many that is", async () => {
    const result = await redeemPoints({ tenantId, partyId: customerId, points: 500 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/200 points/);
  });

  it("refuses a non-member", async () => {
    const result = await redeemPoints({ tenantId, partyId: noPhoneId, points: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a member/i);
  });
});

describe("adjustments", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, {});
    await enrolMember({ tenantId, partyId: customerId });
  });

  it("insists on a reason", async () => {
    await expect(adjustPoints({ tenantId, partyId: customerId, points: 10, note: "  " })).rejects.toThrow(/reason/i);
  });

  it("will not push a balance below zero", async () => {
    await expect(
      adjustPoints({ tenantId, partyId: customerId, points: -5, note: "Clawback" })
    ).rejects.toThrow(/below zero/i);
  });
});

describe("enrolment", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, {});
  });

  it("is idempotent — pressing the button twice does not reset anything", async () => {
    const first = await enrolMember({ tenantId, partyId: customerId });
    await prisma.loyaltyAccount.update({ where: { id: first.id }, data: { pointsBalance: 42 } });
    const second = await enrolMember({ tenantId, partyId: customerId });
    expect(second.id).toBe(first.id);
    expect(second.pointsBalance).toBe(42);
  });

  it("refuses the walk-in record outright", async () => {
    await expect(enrolMember({ tenantId, partyId: walkInId })).rejects.toThrow(/walk-in/i);
  });
});

describe("finding somebody at the counter", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, {});
    await enrolMember({ tenantId, partyId: customerId });
  });

  it("matches however the number was typed", async () => {
    for (const typed of ["0721234567", "+27 72 123 4567", "27721234567", "072 123 4567"]) {
      const found = await findMemberByPhone(tenantId, typed);
      expect(found?.party.id, `should have matched ${typed}`).toBe(customerId);
    }
  });

  it("returns nothing for a number nobody has", async () => {
    expect(await findMemberByPhone(tenantId, "0999999999")).toBeNull();
  });

  it("ignores something too short to be a number", async () => {
    expect(await findMemberByPhone(tenantId, "12")).toBeNull();
  });
});

describe("the lists a shop actually uses", () => {
  beforeEach(async () => {
    await saveLoyaltyProgram(tenantId, { earnPointsPerUnit: 1, redeemCentsPerPoint: 5 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 100000 });
  });

  it("ranks the best customers by what they have actually spent", async () => {
    const rows = await topMembers(tenantId);
    expect(rows[0].partyId).toBe(customerId);
    expect(rows[0].lifetimeSpendCents).toBe(100000);
  });

  it("finds who has stopped coming", async () => {
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { tenantId_partyId: { tenantId, partyId: customerId } },
    });
    const longAgo = new Date(Date.now() - 90 * 86_400_000);
    await prisma.loyaltyAccount.update({ where: { id: account.id }, data: { lastActivityAt: longAgo } });

    const rows = await lapsedMembers(tenantId, 60);
    expect(rows).toHaveLength(1);
    expect(rows[0].daysSinceLastActivity).toBeGreaterThanOrEqual(89);
  });

  it("states the liability, not just the membership count", async () => {
    const summary = await loyaltySummary(tenantId);
    expect(summary.members).toBe(1);
    expect(summary.pointsOutstanding).toBe(1000);
    expect(summary.liabilityCents).toBe(5000);
  });

  it("says plainly when there is no programme at all", async () => {
    await prisma.loyaltyProgram.deleteMany({ where: { tenantId } });
    const summary = await loyaltySummary(tenantId);
    expect(summary.active).toBe(false);
    expect(summary.summary).toMatch(/no rewards programme/i);
  });

  it("shows the statement behind one balance", async () => {
    const history = await memberHistory(tenantId, customerId);
    expect(history?.pointsBalance).toBe(1000);
    expect(history?.entries).toHaveLength(1);
    expect(history?.entries[0].kind).toBe("EARNED");
  });

  it("returns nothing for somebody who never joined", async () => {
    expect(await memberHistory(tenantId, noPhoneId)).toBeNull();
  });
});

describe("expiry", () => {
  it("does nothing when the programme never expires", async () => {
    await saveLoyaltyProgram(tenantId, { expireAfterDays: null });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 50000 });
    expect(await expireStalePoints(tenantId)).toBe(0);
  });

  it("zeroes a stale balance and leaves an entry explaining why", async () => {
    await saveLoyaltyProgram(tenantId, { expireAfterDays: 30 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 50000 });

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { tenantId_partyId: { tenantId, partyId: customerId } },
    });
    await prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: new Date(Date.now() - 200 * 86_400_000) },
    });

    expect(await expireStalePoints(tenantId)).toBe(1);

    const after = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.pointsBalance).toBe(0);

    const expired = await prisma.loyaltyEntry.findFirst({
      where: { accountId: account.id, kind: "EXPIRED" },
    });
    expect(expired?.points).toBe(-500);
    expect(expired?.note).toMatch(/30 days/);
  });

  it("leaves an active member alone", async () => {
    await saveLoyaltyProgram(tenantId, { expireAfterDays: 30 });
    await earnOnSale({ tenantId, partyId: customerId, amountCents: 50000 });
    expect(await expireStalePoints(tenantId)).toBe(0);
  });
});
