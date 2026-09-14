// Cost-rise repricing and supplier performance. Both read data that already
// exists, so what is worth testing is the arithmetic and, more importantly,
// the refusals: an item with no recorded cost has no original margin to
// restore, and guessing one would be worse than staying quiet.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { findCostRises, applySuggestedPrice } from "../../src/lib/core/repricing";
import { supplierPerformance } from "../../src/lib/core/supplierPerformance";

let tenantId: string;
let supplierId: string;

async function receivedOrder(params: {
  itemId: string;
  unitCostCents: number;
  sentAt: Date;
  receivedAt: Date;
  supplier?: string;
}) {
  const po = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      supplierId: params.supplier ?? supplierId,
      status: "RECEIVED",
      totalCostCents: params.unitCostCents,
      sentAt: params.sentAt,
      receivedAt: params.receivedAt,
      createdAt: params.sentAt,
    },
  });
  await prisma.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      itemId: params.itemId,
      quantity: 1,
      unitCostCents: params.unitCostCents,
    },
  });
  return po;
}

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: "Repricing Co", niche: "RETAIL" } });
  tenantId = t.id;
  const s = await prisma.party.create({
    data: { tenantId, name: "Acme Supplies", role: "SUPPLIER" },
  });
  supplierId = s.id;
});

afterAll(async () => {
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("findCostRises", () => {
  it("reports the true margin, not the one the catalogue believes", async () => {
    // Priced at R100 against a recorded cost of R60 — a 40% margin decision.
    const item = await prisma.item.create({
      data: { tenantId, name: "Widget", sku: "W-1", unitPriceCents: 10000, costCents: 6000 },
    });
    // The supplier now charges R80.
    await receivedOrder({
      itemId: item.id,
      unitCostCents: 8000,
      sentAt: new Date("2026-05-01T09:00:00Z"),
      receivedAt: new Date("2026-05-05T09:00:00Z"),
    });

    const report = await findCostRises(tenantId);
    const line = report.lines.find((l) => l.itemId === item.id)!;

    expect(line.marginAssumedPercent).toBe(40); // what every report says
    expect(line.marginNowPercent).toBe(20); // what is actually happening
    expect(line.costMovePercent).toBeCloseTo(33.3, 0);
    // Restoring a 40% margin on a R80 cost means selling at R133.34.
    expect(line.suggestedPriceCents).toBe(13334);
    expect(line.sellingAtALoss).toBe(false);
    // South African formatting: comma for the decimal separator.
    expect(line.basis).toContain("R80,00");

    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: item.id } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.item.delete({ where: { id: item.id } });
  });

  it("puts a loss-making item at the top and says so plainly", async () => {
    const fine = await prisma.item.create({
      data: { tenantId, name: "Fine Item", unitPriceCents: 10000, costCents: 6000 },
    });
    const losing = await prisma.item.create({
      data: { tenantId, name: "Losing Item", unitPriceCents: 5000, costCents: 3000 },
    });

    await receivedOrder({
      itemId: fine.id,
      unitCostCents: 7000,
      sentAt: new Date("2026-05-01T09:00:00Z"),
      receivedAt: new Date("2026-05-04T09:00:00Z"),
    });
    await receivedOrder({
      itemId: losing.id,
      unitCostCents: 5500, // costs more than it sells for
      sentAt: new Date("2026-05-01T09:00:00Z"),
      receivedAt: new Date("2026-05-04T09:00:00Z"),
    });

    const report = await findCostRises(tenantId);
    expect(report.lines[0].name).toBe("Losing Item");
    expect(report.lines[0].sellingAtALoss).toBe(true);
    expect(report.summary).toContain("every one sold loses money");
    // The caveat exists because a loss leader is a real thing and the report
    // must not imply the owner has made a mistake.
    expect(report.caveats.some((c) => c.includes("loss leader"))).toBe(true);

    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.item.deleteMany({ where: { id: { in: [fine.id, losing.id] } } });
  });

  it("stays quiet about an item with no recorded cost", async () => {
    const item = await prisma.item.create({
      data: { tenantId, name: "No Cost Item", unitPriceCents: 10000, costCents: null },
    });
    await receivedOrder({
      itemId: item.id,
      unitCostCents: 9000,
      sentAt: new Date("2026-05-01T09:00:00Z"),
      receivedAt: new Date("2026-05-04T09:00:00Z"),
    });

    const report = await findCostRises(tenantId);
    expect(report.lines.find((l) => l.itemId === item.id)).toBeUndefined();

    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.item.delete({ where: { id: item.id } });
  });

  it("ignores a move too small to be a decision", async () => {
    const item = await prisma.item.create({
      data: { tenantId, name: "Barely Moved", unitPriceCents: 10000, costCents: 6000 },
    });
    await receivedOrder({
      itemId: item.id,
      unitCostCents: 6050, // 0.8%
      sentAt: new Date("2026-05-01T09:00:00Z"),
      receivedAt: new Date("2026-05-04T09:00:00Z"),
    });

    const report = await findCostRises(tenantId);
    expect(report.lines.find((l) => l.itemId === item.id)).toBeUndefined();

    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.item.delete({ where: { id: item.id } });
  });

  it("refuses to reprice another workspace's product", async () => {
    const other = await prisma.tenant.create({ data: { name: "Nope Co", niche: "RETAIL" } });
    const theirItem = await prisma.item.create({
      data: { tenantId: other.id, name: "Theirs", unitPriceCents: 1000 },
    });
    await expect(
      applySuggestedPrice({ tenantId, itemId: theirItem.id, unitPriceCents: 9999 })
    ).rejects.toThrow(/not found/);

    await prisma.item.delete({ where: { id: theirItem.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("supplierPerformance", () => {
  it("uses the median lead time so one bad order does not define a supplier", async () => {
    const t = await prisma.tenant.create({ data: { name: "Lead Co", niche: "RETAIL" } });
    const s = await prisma.party.create({
      data: { tenantId: t.id, name: "Reliable Ltd", role: "SUPPLIER" },
    });
    const item = await prisma.item.create({
      data: { tenantId: t.id, name: "Thing", unitPriceCents: 1000 },
    });

    // Four quick deliveries and one disaster.
    const spans = [3, 3, 4, 3, 30];
    for (let i = 0; i < spans.length; i++) {
      const sent = new Date(Date.UTC(2026, 3, 1 + i * 40));
      const po = await prisma.purchaseOrder.create({
        data: {
          tenantId: t.id,
          supplierId: s.id,
          status: "RECEIVED",
          totalCostCents: 1000,
          createdAt: sent,
          sentAt: sent,
          receivedAt: new Date(sent.getTime() + spans[i] * 86_400_000),
        },
      });
      await prisma.purchaseOrderLine.create({
        data: { purchaseOrderId: po.id, itemId: item.id, quantity: 1, unitCostCents: 1000 },
      });
    }

    const report = await supplierPerformance(t.id);
    const stat = report.suppliers[0];

    expect(stat.medianLeadDays).toBe(3); // not the ~8.6 a mean would give
    expect(stat.worstLeadDays).toBe(30);
    expect(stat.ordersReceived).toBe(5);
    // The flag is about unpredictability, which is the thing that actually
    // breaks planning.
    expect(stat.flags.some((f) => f.includes("hard to plan around"))).toBe(true);

    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId: t.id } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId: t.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.party.delete({ where: { id: s.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("notices a price that crept up across repeat orders", async () => {
    const t = await prisma.tenant.create({ data: { name: "Drift Co", niche: "RETAIL" } });
    const s = await prisma.party.create({
      data: { tenantId: t.id, name: "Creeper Supplies", role: "SUPPLIER" },
    });
    const item = await prisma.item.create({
      data: { tenantId: t.id, name: "Drifty", unitPriceCents: 2000 },
    });

    // Three small rises nobody queried: R10.00, R10.50, R11.20.
    for (const [i, cost] of [1000, 1050, 1120].entries()) {
      const sent = new Date(Date.UTC(2026, i * 3, 1));
      const po = await prisma.purchaseOrder.create({
        data: {
          tenantId: t.id,
          supplierId: s.id,
          status: "RECEIVED",
          totalCostCents: cost,
          createdAt: sent,
          sentAt: sent,
          receivedAt: new Date(sent.getTime() + 2 * 86_400_000),
        },
      });
      await prisma.purchaseOrderLine.create({
        data: { purchaseOrderId: po.id, itemId: item.id, quantity: 1, unitCostCents: cost },
      });
    }

    const report = await supplierPerformance(t.id);
    expect(report.suppliers[0].priceDriftPercent).toBeCloseTo(12, 0);
    expect(report.suppliers[0].flags.some((f) => f.includes("Prices up 12%"))).toBe(true);

    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId: t.id } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId: t.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.party.delete({ where: { id: s.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });

  it("does not hold a draft order against anyone", async () => {
    const t = await prisma.tenant.create({ data: { name: "Draft Co", niche: "RETAIL" } });
    const s = await prisma.party.create({
      data: { tenantId: t.id, name: "Unused Ltd", role: "SUPPLIER" },
    });
    await prisma.purchaseOrder.create({
      data: { tenantId: t.id, supplierId: s.id, status: "DRAFT", totalCostCents: 5000 },
    });

    const report = await supplierPerformance(t.id);
    expect(report.suppliers).toHaveLength(0);

    await prisma.purchaseOrder.deleteMany({ where: { tenantId: t.id } });
    await prisma.party.delete({ where: { id: s.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});
