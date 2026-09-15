// Importing quotes from a Zoho export: lines grouped into documents, the
// source number kept so a second run repairs instead of duplicating, and the
// details that were read and dropped now landing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import { importDocuments, adoptExistingReferences, parseDate } from "../../src/lib/import/documents";

let tenantId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Import Co", niche: "SERVICES" } });
  tenantId = t.id;
});

afterEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

const row = (over: Record<string, string>) => ({
  customerName: "Solar Client", amountCents: "57,500.00", status: "Sent", date: "12/03/2026", reference: "EST-0042",
  itemName: "", itemDescription: "", itemQuantity: "", itemRate: "", itemTaxPercent: "", itemDiscountPercent: "", subject: "8kVA system",
  ...over,
});

describe("importing Zoho estimates", () => {
  it("groups one-row-per-line into one quote with every line, description and tax", async () => {
    const r = await importDocuments({
      tenantId, target: "quotes", partyRole: "CUSTOMER",
      records: [
        row({ itemName: "Deye 8kVA Hybrid Inverter", itemDescription: "Includes WiFi dongle", itemQuantity: "1", itemRate: "35,000.00", itemTaxPercent: "15" }),
        row({ itemName: "Installation", itemQuantity: "1", itemRate: "15,000.00", itemTaxPercent: "15", itemDiscountPercent: "10" }),
      ],
    });
    expect(r).toMatchObject({ imported: 1, withoutLines: 0, repaired: 0 });
    const q = await prisma.transaction.findFirstOrThrow({ where: { tenantId }, include: { itemLines: { include: { item: true } } } });
    expect(q.externalRef).toBe("EST-0042");
    expect(q.subject).toBe("8kVA system");
    expect(q.itemLines).toHaveLength(2);
    const inverter = q.itemLines.find((l) => l.item.name.startsWith("Deye"))!;
    expect(inverter.unitPriceCents).toBe(35_000_00);
    expect(inverter.taxRatePercent).toBe(15);
    expect(inverter.item.description).toBe("Includes WiFi dongle");
    expect(q.itemLines.find((l) => l.item.name === "Installation")!.discountPercent).toBe(10);
    // dd/mm/yyyy read as the 12th of March, not the 3rd of December
    expect(q.createdAt.toISOString().slice(0, 10)).toBe("2026-03-12");
  });

  it("does not duplicate on a second run", async () => {
    const records = [row({ itemName: "Panel", itemQuantity: "10", itemRate: "2,000" })];
    await importDocuments({ tenantId, target: "quotes", partyRole: "CUSTOMER", records });
    const again = await importDocuments({ tenantId, target: "quotes", partyRole: "CUSTOMER", records });
    expect(again).toMatchObject({ imported: 0, alreadyHere: 1 });
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(1);
  });

  it("says when quotes came in without items, and fills them in when re-imported with the item columns", async () => {
    const headerOnly = [row({})];
    const first = await importDocuments({ tenantId, target: "quotes", partyRole: "CUSTOMER", records: headerOnly });
    expect(first).toMatchObject({ imported: 1, withoutLines: 1 });

    const withItems = [row({ itemName: "Battery 5kWh", itemQuantity: "2", itemRate: "25,000" })];
    const second = await importDocuments({ tenantId, target: "quotes", partyRole: "CUSTOMER", records: withItems });
    expect(second).toMatchObject({ imported: 0, repaired: 1 });
    const q = await prisma.transaction.findFirstOrThrow({ where: { tenantId }, include: { itemLines: true } });
    expect(q.itemLines).toHaveLength(1);
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(1);
  });

  it("adopts the source number for a quote imported before numbers were kept, then repairs it", async () => {
    const p = await prisma.party.create({ data: { tenantId, name: "Solar Client", role: "CUSTOMER" } });
    await prisma.transaction.create({ data: { tenantId, partyId: p.id, type: "QUOTE", status: "SENT", amountCents: 57_500_00, createdAt: parseDate("12/03/2026")! } });
    const records = [row({ itemName: "Inverter", itemQuantity: "1", itemRate: "57,500" })];
    expect(await adoptExistingReferences({ tenantId, target: "quotes", records })).toBe(1);
    const r = await importDocuments({ tenantId, target: "quotes", partyRole: "CUSTOMER", records });
    expect(r).toMatchObject({ imported: 0, repaired: 1 });
    expect(await prisma.transaction.count({ where: { tenantId } })).toBe(1);
  });
});
