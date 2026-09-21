// Skynat Go orders arriving in a merchant's books.
//
// The properties that matter: an order becomes a paid invoice against a real
// customer, a retried push does not duplicate it, and products build a
// catalogue instead of a pile of one-off lines.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { ingestDeliveryOrder, orderRef, platformFees } from "../../src/lib/core/skynatGo";

let tenantId: string;

const order = (overrides: Record<string, unknown> = {}) => ({
  tenantId,
  orderId: "10231",
  storeName: "Bree Street Grocer",
  customer: { name: "Thabo Nkosi", phone: "+27831234567" },
  lines: [
    { name: "Maize meal 5kg", quantity: 2, unitPriceCents: 8990, sku: "MM5" },
    { name: "Cooking oil 750ml", quantity: 1, unitPriceCents: 3450, sku: "OIL750" },
  ],
  totalCents: 21430,
  feeCents: 2143,
  ...overrides,
});

beforeEach(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Grocer Co", niche: "RETAIL" } });
  tenantId = tenant.id;
});

afterEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("Skynat Go order ingestion", () => {
  it("posts a delivered order as a paid invoice against the customer", async () => {
    const result = await ingestDeliveryOrder(order());

    expect(result.created).toBe(true);

    const invoice = await prisma.transaction.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { party: true, itemLines: true },
    });

    expect(invoice.amountCents).toBe(21430);
    expect(invoice.status).toBe("PAID");
    expect(invoice.externalRef).toBe(orderRef("10231"));
    expect(invoice.party.name).toBe("Thabo Nkosi");
    expect(invoice.itemLines).toHaveLength(2);
    // The platform's cut is visible without quietly shrinking turnover.
    expect(invoice.subject).toContain("platform fee 21.43");
    expect(invoice.amountCents).toBe(21430);
  });

  it("does not duplicate an order when the push is retried", async () => {
    const first = await ingestDeliveryOrder(order());
    const second = await ingestDeliveryOrder(order());

    expect(second.created).toBe(false);
    expect(second.invoiceId).toBe(first.invoiceId);
    expect(await prisma.transaction.count({ where: { tenantId, type: "INVOICE" } })).toBe(1);
  });

  it("reuses one customer record across that customer's orders", async () => {
    await ingestDeliveryOrder(order());
    await ingestDeliveryOrder(order({ orderId: "10232" }));

    expect(await prisma.party.count({ where: { tenantId, role: "CUSTOMER" } })).toBe(1);
  });

  it("builds a catalogue rather than a new item per order", async () => {
    await ingestDeliveryOrder(order());
    await ingestDeliveryOrder(order({ orderId: "10233" }));

    const items = await prisma.item.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    expect(items.map((i) => i.sku)).toEqual(["OIL750", "MM5"]);
    expect(items[0].category).toBe("Skynat Go");
  });

  it("leaves an unsettled order unpaid", async () => {
    const result = await ingestDeliveryOrder(order({ orderId: "10234", settled: false }));

    const invoice = await prisma.transaction.findUniqueOrThrow({ where: { id: result.invoiceId } });
    expect(invoice.status).toBe("SENT");
  });

  it("reports what came through the platform over a period", async () => {
    await ingestDeliveryOrder(order());
    await ingestDeliveryOrder(order({ orderId: "10235", totalCents: 5000 }));

    const summary = await platformFees(tenantId, new Date(Date.now() - 86_400_000));
    expect(summary.orders).toBe(2);
    expect(summary.grossCents).toBe(26430);
  });

  it("keeps one workspace's Go orders out of another's", async () => {
    const other = await prisma.tenant.create({ data: { name: "Someone Else", niche: "RETAIL" } });
    try {
      await ingestDeliveryOrder(order());

      const summary = await platformFees(other.id, new Date(Date.now() - 86_400_000));
      expect(summary.orders).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } });
    }
  });
});
