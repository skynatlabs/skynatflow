// Distribution reports read invoices that already exist, so the tests are
// about the judgement in them: penetration counted against outlets that
// actually bought (not every outlet on the map), a must-stock gap defined by
// what the trade does rather than by a list somebody typed, and a dropped
// line needing an established habit before anybody is told.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { saveOutlet } from "../../src/lib/core/outlets";
import {
  penetration,
  mustStockGaps,
  droppedLines,
  channelMix,
} from "../../src/lib/core/distribution";

let tenantId: string;
const items: Record<string, string> = {};

async function shop(name: string, channel: string) {
  const p = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name } });
  await saveOutlet({ tenantId, partyId: p.id, channel });
  return p.id;
}

async function sale(partyId: string, itemKey: string, qty: number, daysAgo = 1) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  const tx = await prisma.transaction.create({
    data: {
      tenantId,
      partyId,
      type: "INVOICE",
      status: "SENT",
      amountCents: qty * 1000,
      createdAt: at,
      itemLines: { create: [{ itemId: items[itemKey], quantity: qty, unitPriceCents: 1000 }] },
    },
  });
  return tx.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Distribution Test Co", niche: "WHOLESALE" } });
  tenantId = tenant.id;
  for (const name of ["Cola 500ml", "Chips 120g", "Soap bar", "Rare energy drink"]) {
    const item = await prisma.item.create({ data: { tenantId, name, unitPriceCents: 1000 } });
    items[name] = item.id;
  }
});

afterAll(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.outlet.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.outlet.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
});

describe("penetration", () => {
  it("counts against outlets that actually bought, not every outlet on the map", async () => {
    const a = await shop("Shop A", "spaza");
    const b = await shop("Shop B", "spaza");
    await shop("Shop C — never orders", "spaza");

    await sale(a, "Cola 500ml", 10);
    await sale(b, "Cola 500ml", 10);
    await sale(a, "Rare energy drink", 1);

    const report = await penetration(tenantId, 90);
    expect(report.outletsBuying).toBe(2);

    const cola = report.rows.find((r) => r.name === "Cola 500ml");
    const rare = report.rows.find((r) => r.name === "Rare energy drink");
    expect(cola?.penetrationPercent).toBe(100);
    expect(rare?.penetrationPercent).toBe(50);
  });

  it("ranks by value moved", async () => {
    const a = await shop("Shop A", "spaza");
    await sale(a, "Cola 500ml", 100);
    await sale(a, "Soap bar", 1);
    const report = await penetration(tenantId, 90);
    expect(report.rows[0].name).toBe("Cola 500ml");
  });

  it("says so plainly when nothing has moved", async () => {
    const report = await penetration(tenantId, 90);
    expect(report.summary).toMatch(/nothing has been sold/i);
  });
});

describe("must-stock gaps", () => {
  it("names a line most comparable shops carry and this one does not", async () => {
    const shops = [];
    for (let i = 0; i < 5; i++) shops.push(await shop(`Spaza ${i}`, "spaza"));

    // Everybody takes cola; only the last one skips it.
    for (const s of shops.slice(0, 4)) await sale(s, "Cola 500ml", 10);
    // Everybody, including the last, takes chips — so it is buying something.
    for (const s of shops) await sale(s, "Chips 120g", 5);

    const gaps = await mustStockGaps(tenantId, { carriedByAtLeastPercent: 60 });
    const laggard = gaps.find((g) => g.outletName === "Spaza 4");
    expect(laggard?.missing.map((m) => m.name)).toContain("Cola 500ml");
  });

  it("ignores a line only a minority carries", async () => {
    const shops = [];
    for (let i = 0; i < 5; i++) shops.push(await shop(`Spaza ${i}`, "spaza"));
    for (const s of shops) await sale(s, "Chips 120g", 5);
    // One shop out of five takes the rare line.
    await sale(shops[0], "Rare energy drink", 1);

    const gaps = await mustStockGaps(tenantId, { carriedByAtLeastPercent: 60 });
    const names = gaps.flatMap((g) => g.missing.map((m) => m.name));
    expect(names).not.toContain("Rare energy drink");
  });

  it("will not compare a channel with almost nobody in it", async () => {
    const a = await shop("Lonely Forecourt", "forecourt");
    const b = await shop("Spaza", "spaza");
    await sale(a, "Chips 120g", 5);
    await sale(b, "Cola 500ml", 5);
    const gaps = await mustStockGaps(tenantId, {});
    expect(gaps).toHaveLength(0);
  });
});

describe("lines that have been dropped", () => {
  it("needs an established habit before it says anything", async () => {
    const a = await shop("Shop A", "spaza");
    // Bought twice, long ago. Two purchases is a coincidence.
    await sale(a, "Cola 500ml", 5, 200);
    await sale(a, "Cola 500ml", 5, 190);

    expect(await droppedLines(tenantId, {})).toHaveLength(0);
  });

  it("flags a fortnightly line that has been missing for months", async () => {
    const a = await shop("Shop A", "spaza");
    for (const daysAgo of [120, 106, 92, 78]) await sale(a, "Cola 500ml", 5, daysAgo);

    const dropped = await droppedLines(tenantId, {});
    expect(dropped).toHaveLength(1);
    expect(dropped[0].itemName).toBe("Cola 500ml");
    expect(dropped[0].typicalGapDays).toBe(14);
    expect(dropped[0].daysSince).toBeGreaterThan(70);
  });

  it("leaves a line still being bought on schedule alone", async () => {
    const a = await shop("Shop A", "spaza");
    for (const daysAgo of [42, 28, 14, 1]) await sale(a, "Cola 500ml", 5, daysAgo);
    expect(await droppedLines(tenantId, {})).toHaveLength(0);
  });

  it("does not nag about a weekly line one week late", async () => {
    const a = await shop("Shop A", "spaza");
    for (const daysAgo of [28, 21, 14, 7]) await sale(a, "Cola 500ml", 5, daysAgo);
    expect(await droppedLines(tenantId, {})).toHaveLength(0);
  });
});

describe("channel mix", () => {
  it("shows where the volume actually goes", async () => {
    const spaza = await shop("Spaza", "spaza");
    const tavern = await shop("Tavern", "tavern");
    await sale(spaza, "Cola 500ml", 10); // R100
    await sale(tavern, "Cola 500ml", 30); // R300

    const rows = await channelMix(tenantId, 90);
    expect(rows[0].channel).toBe("tavern");
    expect(rows[0].sharePercent).toBe(75);
    expect(rows[1].sharePercent).toBe(25);
  });
});
