// PA job: turning a reorder suggestion into a real purchase order sent
// to a supplier — see src/lib/core/purchaseOrders.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  createPurchaseOrder,
  buildPurchaseOrderLinesFromReorderSuggestions,
  sendPurchaseOrder,
  markPurchaseOrderReceived,
} from "../../src/lib/core/purchaseOrders";

let tenantId: string;
let supplierId: string;
let itemId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test PO Co", niche: "RETAIL" } });
  tenantId = tenant.id;
  const supplier = await prisma.party.create({ data: { tenantId, role: PartyRole.SUPPLIER, name: "Test Supplier Ltd", email: "supplier@test.local" } });
  supplierId = supplier.id;
  const item = await prisma.item.create({
    data: { tenantId, name: "Reorder Widget", unitPriceCents: 20000, costCents: 8000, stockQty: 2, reorderPoint: 10 },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { tenantId } } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("createPurchaseOrder", () => {
  it("computes the total cost from lines and persists them", async () => {
    const po = await createPurchaseOrder({
      tenantId, supplierId,
      lines: [{ itemId, quantity: 20, unitCostCents: 8000 }],
    });
    expect(po.totalCostCents).toBe(160000);
    expect(po.status).toBe("DRAFT");
    expect(po.lines).toHaveLength(1);
  });

  it("rejects a purchase order with no lines", async () => {
    await expect(createPurchaseOrder({ tenantId, supplierId, lines: [] })).rejects.toThrow();
  });
});

describe("buildPurchaseOrderLinesFromReorderSuggestions", () => {
  it("uses the item's cost price, sized to the demand engine's own suggested quantity", async () => {
    const lines = await buildPurchaseOrderLinesFromReorderSuggestions(tenantId, [itemId]);
    expect(lines).toHaveLength(1);
    expect(lines[0].unitCostCents).toBe(8000);
    expect(lines[0].quantity).toBeGreaterThan(0);
  });
});

describe("sendPurchaseOrder", () => {
  it("marks the PO as SENT with a timestamp when the supplier has an email", async () => {
    const po = await createPurchaseOrder({ tenantId, supplierId, lines: [{ itemId, quantity: 5, unitCostCents: 8000 }] });
    const result = await sendPurchaseOrder(tenantId, po.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).not.toBeNull();
  });

  it("refuses to send when the supplier has no email on file", async () => {
    const noEmailSupplier = await prisma.party.create({ data: { tenantId, role: PartyRole.SUPPLIER, name: "No Email Supplier" } });
    const po = await createPurchaseOrder({ tenantId, supplierId: noEmailSupplier.id, lines: [{ itemId, quantity: 5, unitCostCents: 8000 }] });

    const result = await sendPurchaseOrder(tenantId, po.id);
    expect(result.ok).toBe(false);

    const unchanged = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(unchanged.status).toBe("DRAFT");
  });
});

describe("markPurchaseOrderReceived", () => {
  it("increments the item's stock by the ordered quantity and marks RECEIVED", async () => {
    const before = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    const po = await createPurchaseOrder({ tenantId, supplierId, lines: [{ itemId, quantity: 15, unitCostCents: 8000 }] });

    await markPurchaseOrderReceived(tenantId, po.id);

    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(after.stockQty).toBe((before.stockQty ?? 0) + 15);

    const updatedPo = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(updatedPo.status).toBe("RECEIVED");
  });
});
