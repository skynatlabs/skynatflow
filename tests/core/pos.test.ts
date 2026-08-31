// PA job: till reconciliation — flag a mismatch between counted cash and
// what the ledger expects, persisted so it survives past the closing
// request itself. See src/lib/core/pos.ts closeTill.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { openTill, closeTill, checkoutSale } from "../../src/lib/core/pos";

let tenantId: string;
let itemId: string;
let membershipUserId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Till Co", niche: "RETAIL" } });
  tenantId = tenant.id;
  const item = await prisma.item.create({ data: { tenantId, name: "Till Test Widget", unitPriceCents: 10000 } });
  itemId = item.id;
  const user = await prisma.user.create({ data: { email: `till-test-${tenant.id}@test.local`, name: "Till Tester" } });
  membershipUserId = user.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.tillSession.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.delete({ where: { id: membershipUserId } });
});

describe("closeTill — reconciliation variance", () => {
  it("persists zero variance when the counted cash matches expected exactly", async () => {
    const session = await openTill({ tenantId, openedById: membershipUserId, openingFloatCents: 50000 });
    await checkoutSale({ tenantId, lines: [{ itemId, quantity: 1, unitPriceCents: 10000 }], paymentMethod: "cash", tillSessionId: session.id });

    const closed = await closeTill(session.id, 60000, membershipUserId);
    expect(closed.varianceCents).toBe(0);

    const persisted = await prisma.tillSession.findUnique({ where: { id: session.id } });
    expect(persisted?.varianceCents).toBe(0);
  });

  it("flags a shortfall as a negative persisted variance", async () => {
    const session = await openTill({ tenantId, openedById: membershipUserId, openingFloatCents: 50000 });
    await checkoutSale({ tenantId, lines: [{ itemId, quantity: 1, unitPriceCents: 10000 }], paymentMethod: "cash", tillSessionId: session.id });

    // Expected 60000, only 55000 actually counted — a 5000c shortfall.
    const closed = await closeTill(session.id, 55000, membershipUserId);
    expect(closed.varianceCents).toBe(-5000);

    const persisted = await prisma.tillSession.findUnique({ where: { id: session.id } });
    expect(persisted?.varianceCents).toBe(-5000);
  });

  it("ignores card sales when computing the expected cash amount", async () => {
    const session = await openTill({ tenantId, openedById: membershipUserId, openingFloatCents: 50000 });
    await checkoutSale({ tenantId, lines: [{ itemId, quantity: 1, unitPriceCents: 10000 }], paymentMethod: "cash", tillSessionId: session.id });
    await checkoutSale({ tenantId, lines: [{ itemId, quantity: 1, unitPriceCents: 99999 }], paymentMethod: "card", tillSessionId: session.id });

    // Expected is still just float + cash sale (60000) — the card sale
    // shouldn't inflate what we expect to find in the drawer.
    const closed = await closeTill(session.id, 60000, membershipUserId);
    expect(closed.varianceCents).toBe(0);
  });
});
