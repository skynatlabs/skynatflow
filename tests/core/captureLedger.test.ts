// The capture ledger.
//
// The one number every cost figure should be read next to. Its honesty
// property: with no bank feed it says "unknown", never 100%.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { ensureChartOfAccounts, accountByCode } from "../../src/lib/core/ledger";
import { submitExpense } from "../../src/lib/core/expenses";
import { startTrip, endTrip } from "../../src/lib/core/trips";
import { captureLedger } from "../../src/lib/core/captureLedger";

let tenantId: string;
let ownerId: string;
let userId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Capture Co", niche: "SERVICES" } });
  tenantId = t.id;
  await ensureChartOfAccounts(tenantId);
  const u = await prisma.user.create({ data: { email: `cap-${t.id}@test.local`, name: "Owner" } });
  userId = u.id;
  ownerId = (await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } })).id;
});

afterEach(async () => {
  await prisma.bankTransaction.deleteMany({ where: { tenantId } });
  await prisma.bankAccount.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.trip.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("captureLedger", () => {
  it("does not claim a percentage it cannot know", async () => {
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Fuel", amountCents: 500_00, isOwnerDrawing: false });
    const l = await captureLedger(tenantId);
    expect(l.hasBankFeed).toBe(false);
    expect(l.coveragePercent).toBeNull();
    expect(l.recordedCents).toBe(500_00);
    expect(l.gaps.some((g) => g.kind === "NO_BANK_FEED")).toBe(true);
    expect(l.summary).toContain("unknown");
  });

  it("measures recorded spend against unexplained money out of the bank", async () => {
    const ledgerAccount = await accountByCode(tenantId, "1000");
    const bank = await prisma.bankAccount.create({ data: { tenantId, name: "Cheque", accountId: ledgerAccount!.id } });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Fuel", amountCents: 3_000_00, isOwnerDrawing: false });
    await prisma.bankTransaction.create({
      data: { bankAccountId: bank.id, tenantId, postedOn: new Date(), description: "CARD PURCHASE", amountCents: -1_000_00, fingerprint: "x1" },
    });
    // Money in is not a gap, and neither is a matched line.
    await prisma.bankTransaction.create({
      data: { bankAccountId: bank.id, tenantId, postedOn: new Date(), description: "DEPOSIT", amountCents: 5_000_00, fingerprint: "x2" },
    });

    const l = await captureLedger(tenantId);
    expect(l.hasBankFeed).toBe(true);
    expect(l.unexplainedCents).toBe(1_000_00);
    expect(l.coveragePercent).toBe(75);
    expect(l.summary).toContain("75%");
  });

  it("names a vehicle that moved and recorded nothing", async () => {
    const van = await prisma.asset.create({ data: { tenantId, name: "Van", capacityUnit: "KM" } });
    const t = await startTrip({ tenantId, assetId: van.id, startedAt: new Date(Date.now() - 86_400_000) });
    await endTrip(tenantId, t.id, { distanceKm: 80, at: new Date() });

    const l = await captureLedger(tenantId);
    const gap = l.gaps.find((g) => g.kind === "VEHICLE_NO_FUEL");
    expect(gap).toBeTruthy();
    expect(gap!.label).toContain("Van");
    expect(gap!.subjectId).toBe(van.id);

    // And stops naming it once a cost lands on it.
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "Diesel", amountCents: 400_00, assetId: van.id, isOwnerDrawing: false });
    const after = await captureLedger(tenantId);
    expect(after.gaps.some((g) => g.kind === "VEHICLE_NO_FUEL")).toBe(false);
  });

  it("counts spend by the route it arrived", async () => {
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "A", amountCents: 100_00, source: "CAMERA", isOwnerDrawing: false });
    await submitExpense({ tenantId, submittedById: ownerId, descriptionText: "B", amountCents: 300_00, source: "DESKTOP", isOwnerDrawing: false });
    const l = await captureLedger(tenantId);
    expect(l.bySource[0]).toMatchObject({ source: "DESKTOP", cents: 300_00, count: 1 });
    expect(l.bySource[1]).toMatchObject({ source: "CAMERA", cents: 100_00, count: 1 });
  });
});
