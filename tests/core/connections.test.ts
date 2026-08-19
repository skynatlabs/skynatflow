import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  inviteConnection,
  respondToConnection,
  listConnectionsForTenant,
  placeConnectedOrder,
} from "../../src/lib/core/connections";

let supplierTenantId: string;
let buyerTenantId: string;
let itemId: string;

beforeAll(async () => {
  const supplier = await prisma.tenant.create({
    data: { name: "Test Wholesale Supplier", niche: "WHOLESALE" },
  });
  const buyer = await prisma.tenant.create({
    data: { name: "Test Retail Buyer", niche: "RETAIL" },
  });
  supplierTenantId = supplier.id;
  buyerTenantId = buyer.id;

  const item = await prisma.item.create({
    data: { tenantId: supplierTenantId, name: "Pallet of goods", unitPriceCents: 1000000 },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId: supplierTenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId: supplierTenantId } });
  await prisma.wholesaleConnection.deleteMany({
    where: { OR: [{ supplierTenantId }, { buyerTenantId }] },
  });
  await prisma.party.deleteMany({ where: { tenantId: supplierTenantId } });
  await prisma.item.deleteMany({ where: { tenantId: supplierTenantId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [supplierTenantId, buyerTenantId] } } });
  await prisma.$disconnect();
});

describe("wholesaler-retailer connections", () => {
  it("starts a connection as PENDING", async () => {
    const connection = await inviteConnection({ supplierTenantId, buyerTenantId });
    expect(connection.status).toBe("PENDING");
  });

  it("rejects placing an order before the connection is accepted", async () => {
    const connection = await prisma.wholesaleConnection.findFirstOrThrow({
      where: { supplierTenantId, buyerTenantId },
    });
    await expect(
      placeConnectedOrder({ connectionId: connection.id, lines: [{ itemId, quantity: 1 }] })
    ).rejects.toThrow();
  });

  it("applies the connection's discount to a connected order", async () => {
    const connection = await prisma.wholesaleConnection.findFirstOrThrow({
      where: { supplierTenantId, buyerTenantId },
    });
    await respondToConnection(connection.id, "ACCEPTED");
    await prisma.wholesaleConnection.update({
      where: { id: connection.id },
      data: { discountPercent: 10 },
    });

    const quote = await placeConnectedOrder({
      connectionId: connection.id,
      lines: [{ itemId, quantity: 2 }],
    });

    // 2 x 1,000,000c at 10% off = 1,800,000c, not the full 2,000,000c —
    // this is the one piece of real business logic in the connection layer.
    expect(quote.amountCents).toBe(1800000);
  });

  it("shows up in listConnectionsForTenant for both sides", async () => {
    const supplierSide = await listConnectionsForTenant(supplierTenantId);
    const buyerSide = await listConnectionsForTenant(buyerTenantId);
    expect(supplierSide.some((c) => c.buyerTenantId === buyerTenantId)).toBe(true);
    expect(buyerSide.some((c) => c.supplierTenantId === supplierTenantId)).toBe(true);
  });
});
