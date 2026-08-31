// PA jobs: lead-assignment balancing, commission/revenue rollup, and
// team performance — all built on the existing salesperson attribution
// on Transaction. See src/lib/core/salesReporting.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { createQuote, recordResponse } from "../../src/lib/core/money";
import { suggestSalesPersonForNewLead, getTeamPerformance } from "../../src/lib/core/salesReporting";

let tenantId: string;
let customerId: string;
let itemId: string;
let repAId: string;
let repBId: string;
let userIds: string[] = [];

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Sales Team Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const customer = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Sales Report Customer" } });
  customerId = customer.id;
  const item = await prisma.item.create({ data: { tenantId, name: "Reporting Widget", unitPriceCents: 100000 } });
  itemId = item.id;

  const userA = await prisma.user.create({ data: { email: `rep-a-${tenant.id}@test.local`, name: "Rep A (busy)" } });
  const userB = await prisma.user.create({ data: { email: `rep-b-${tenant.id}@test.local`, name: "Rep B (free)" } });
  userIds = [userA.id, userB.id];

  const membershipA = await prisma.membership.create({ data: { userId: userA.id, tenantId, role: "REP" } });
  const membershipB = await prisma.membership.create({ data: { userId: userB.id, tenantId, role: "REP" } });
  repAId = membershipA.id;
  repBId = membershipB.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("suggestSalesPersonForNewLead — balance by current open-quote load", () => {
  it("suggests the rep with fewer open quotes", async () => {
    // Rep A has 2 open (SENT) quotes, Rep B has 0 — B should be suggested.
    for (let i = 0; i < 2; i++) {
      const q = await createQuote({ tenantId, partyId: customerId, lines: [{ itemId, quantity: 1, unitPriceCents: 100000 }], salesPersonMembershipId: repAId });
      await prisma.transaction.update({ where: { id: q.id }, data: { status: "SENT" } });
    }

    const suggestion = await suggestSalesPersonForNewLead(tenantId);
    expect(suggestion?.membershipId).toBe(repBId);
    expect(suggestion?.openQuoteCount).toBe(0);
  });
});

describe("getTeamPerformance — revenue and conversion per rep", () => {
  it("only counts ACCEPTED/PAID quotes toward revenue won, and computes conversion correctly", async () => {
    const accepted = await createQuote({ tenantId, partyId: customerId, lines: [{ itemId, quantity: 1, unitPriceCents: 200000 }], salesPersonMembershipId: repBId });
    await recordResponse(accepted.id, "ACCEPTED");

    const declined = await createQuote({ tenantId, partyId: customerId, lines: [{ itemId, quantity: 1, unitPriceCents: 300000 }], salesPersonMembershipId: repBId });
    await recordResponse(declined.id, "DECLINED");

    const performance = await getTeamPerformance(tenantId);
    const repB = performance.find((p) => p.membershipId === repBId);

    expect(repB?.quotesSent).toBe(2);
    expect(repB?.quotesAccepted).toBe(1);
    expect(repB?.conversionRate).toBeCloseTo(0.5);
    expect(repB?.revenueWonCents).toBe(200000);
  });

  it("excludes a rep with zero quotes from the results entirely", async () => {
    const freshUser = await prisma.user.create({ data: { email: `rep-c-${tenantId}@test.local`, name: "Rep C (idle)" } });
    userIds.push(freshUser.id);
    const freshMembership = await prisma.membership.create({ data: { userId: freshUser.id, tenantId, role: "REP" } });

    const performance = await getTeamPerformance(tenantId);
    expect(performance.some((p) => p.membershipId === freshMembership.id)).toBe(false);
  });
});
