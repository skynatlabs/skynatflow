// Two rules carry the pick list and both are about not letting convenience
// win: expiry beats location, and the walk is one pass through the building
// rather than the order somebody typed the lines.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  saveBin,
  listBins,
  putAway,
  moveStock,
  buildPickList,
  confirmPick,
  countBin,
  unplacedStock,
} from "../../src/lib/core/warehouse";

let tenantId: string;
let cement: string;
let milk: string;

async function item(name: string, stockQty: number | null = 100) {
  const created = await prisma.item.create({
    data: { tenantId, name, unitPriceCents: 0, stockQty },
  });
  return created.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Warehouse Test Co", niche: "WHOLESALE" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.stockPlacement.deleteMany({ where: { tenantId } });
  await prisma.stockBin.deleteMany({ where: { tenantId } });
  await prisma.itemBatch.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.stockPlacement.deleteMany({ where: { tenantId } });
  await prisma.stockBin.deleteMany({ where: { tenantId } });
  await prisma.itemBatch.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  cement = await item("Cement 50kg");
  milk = await item("Long life milk 1L");
});

describe("bins", () => {
  it("upper-cases the code so a rack label is not typed two ways", async () => {
    const bin = await saveBin({ tenantId, code: "a-12-3" });
    expect(bin.code).toBe("A-12-3");
  });

  it("refuses a second bin with the same code", async () => {
    await saveBin({ tenantId, code: "A-12-3" });
    await expect(saveBin({ tenantId, code: "a-12-3" })).rejects.toThrow(/already a bin/i);
  });

  it("orders by walking sequence, then by code", async () => {
    await saveBin({ tenantId, code: "Z-01", pickSequence: 1 });
    await saveBin({ tenantId, code: "A-01", pickSequence: 9 });
    const bins = await listBins(tenantId);
    expect(bins.map((b) => b.code)).toEqual(["Z-01", "A-01"]);
  });
});

describe("putting stock away", () => {
  it("adds to what is already there rather than replacing it", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 40 });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 20 });

    const placement = await prisma.stockPlacement.findFirstOrThrow({
      where: { tenantId, binId: bin.id, itemId: cement },
    });
    expect(placement.quantity).toBe(60);
  });

  it("refuses a product from another workspace", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "RETAIL" } });
    const theirs = await prisma.item.create({
      data: { tenantId: other.id, name: "Theirs", unitPriceCents: 0 },
    });
    await expect(
      putAway({ tenantId, binId: bin.id, itemId: theirs.id, quantity: 1 })
    ).rejects.toThrow(/not in this workspace/i);
    await prisma.item.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("refuses putting away nothing", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await expect(
      putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 0 })
    ).rejects.toThrow(/more than nothing/i);
  });
});

describe("moving stock", () => {
  it("moves it, or moves none of it", async () => {
    const from = await saveBin({ tenantId, code: "A-01" });
    const to = await saveBin({ tenantId, code: "B-01" });
    await putAway({ tenantId, binId: from.id, itemId: cement, quantity: 10 });

    await expect(
      moveStock({ tenantId, fromBinId: from.id, toBinId: to.id, itemId: cement, quantity: 50 })
    ).rejects.toThrow(/only has 10/);

    const untouched = await prisma.stockPlacement.findFirstOrThrow({
      where: { binId: from.id, itemId: cement },
    });
    expect(untouched.quantity).toBe(10);
  });

  it("moves what it can", async () => {
    const from = await saveBin({ tenantId, code: "A-01" });
    const to = await saveBin({ tenantId, code: "B-01" });
    await putAway({ tenantId, binId: from.id, itemId: cement, quantity: 10 });
    await moveStock({ tenantId, fromBinId: from.id, toBinId: to.id, itemId: cement, quantity: 4 });

    const source = await prisma.stockPlacement.findFirstOrThrow({ where: { binId: from.id } });
    const target = await prisma.stockPlacement.findFirstOrThrow({ where: { binId: to.id } });
    expect(source.quantity).toBe(6);
    expect(target.quantity).toBe(4);
  });

  it("refuses moving a bin into itself", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await expect(
      moveStock({ tenantId, fromBinId: bin.id, toBinId: bin.id, itemId: cement, quantity: 1 })
    ).rejects.toThrow(/same bin/i);
  });
});

describe("the pick list", () => {
  it("sends the batch that expires first, even when it is further to walk", async () => {
    const near = await saveBin({ tenantId, code: "A-01", pickSequence: 1 });
    const far = await saveBin({ tenantId, code: "Z-99", pickSequence: 99 });

    const soon = await prisma.itemBatch.create({
      data: {
        tenantId,
        itemId: milk,
        quantity: 50,
        expiresAt: new Date(Date.now() + 10 * 86_400_000),
      },
    });
    const later = await prisma.itemBatch.create({
      data: {
        tenantId,
        itemId: milk,
        quantity: 50,
        expiresAt: new Date(Date.now() + 200 * 86_400_000),
      },
    });

    await putAway({ tenantId, binId: near.id, itemId: milk, quantity: 50, batchId: later.id });
    await putAway({ tenantId, binId: far.id, itemId: milk, quantity: 50, batchId: soon.id });

    const list = await buildPickList({ tenantId, lines: [{ itemId: milk, quantity: 20 }] });
    expect(list.instructions[0].binCode).toBe("Z-99");
    expect(list.instructions[0].batchId).toBe(soon.id);
  });

  it("walks the building once, not in the order the lines were typed", async () => {
    const first = await saveBin({ tenantId, code: "A-01", pickSequence: 1 });
    const last = await saveBin({ tenantId, code: "Z-01", pickSequence: 50 });
    await putAway({ tenantId, binId: last.id, itemId: cement, quantity: 10 });
    await putAway({ tenantId, binId: first.id, itemId: milk, quantity: 10 });

    const list = await buildPickList({
      tenantId,
      lines: [
        { itemId: cement, quantity: 5 },
        { itemId: milk, quantity: 5 },
      ],
    });
    expect(list.instructions.map((i) => i.binCode)).toEqual(["A-01", "Z-01"]);
  });

  it("spills across bins when one does not hold enough", async () => {
    const a = await saveBin({ tenantId, code: "A-01", pickSequence: 1 });
    const b = await saveBin({ tenantId, code: "B-01", pickSequence: 2 });
    await putAway({ tenantId, binId: a.id, itemId: cement, quantity: 6 });
    await putAway({ tenantId, binId: b.id, itemId: cement, quantity: 10 });

    const list = await buildPickList({ tenantId, lines: [{ itemId: cement, quantity: 12 }] });
    expect(list.instructions.map((i) => i.quantity)).toEqual([6, 6]);
    expect(list.short).toHaveLength(0);
  });

  it("says what it is short, rather than silently picking less", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 3 });

    const list = await buildPickList({ tenantId, lines: [{ itemId: cement, quantity: 10 }] });
    expect(list.short).toHaveLength(1);
    expect(list.short[0].wanted).toBe(10);
    expect(list.short[0].found).toBe(3);
    expect(list.summary).toMatch(/short/i);
  });

  it("never picks from a bin held back", async () => {
    const quarantine = await saveBin({ tenantId, code: "QUAR-1", isPickable: false });
    await putAway({ tenantId, binId: quarantine.id, itemId: cement, quantity: 100 });

    const list = await buildPickList({ tenantId, lines: [{ itemId: cement, quantity: 5 }] });
    expect(list.instructions).toHaveLength(0);
    expect(list.short[0].found).toBe(0);
  });
});

describe("confirming a pick", () => {
  it("takes it off the bin", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 10 });
    await confirmPick({ tenantId, binId: bin.id, itemId: cement, quantity: 4 });

    const placement = await prisma.stockPlacement.findFirstOrThrow({ where: { binId: bin.id } });
    expect(placement.quantity).toBe(6);
  });

  it("refuses more than the bin holds", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 2 });
    await expect(
      confirmPick({ tenantId, binId: bin.id, itemId: cement, quantity: 5 })
    ).rejects.toThrow(/only has 2/);
  });
});

describe("counting a bin", () => {
  it("reports what changed rather than adjusting quietly", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 10 });

    const variances = await countBin({
      tenantId,
      binId: bin.id,
      counts: [{ itemId: cement, countedQty: 7 }],
    });
    expect(variances).toHaveLength(1);
    expect(variances[0].varianceQty).toBe(-3);

    const placement = await prisma.stockPlacement.findFirstOrThrow({ where: { binId: bin.id } });
    expect(placement.quantity).toBe(7);
    expect(placement.countedAt).not.toBeNull();
  });

  it("reports nothing when the count agrees", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 10 });
    const variances = await countBin({
      tenantId,
      binId: bin.id,
      counts: [{ itemId: cement, countedQty: 10 }],
    });
    expect(variances).toHaveLength(0);
  });

  it("records stock found in a bin the system did not know about", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    const variances = await countBin({
      tenantId,
      binId: bin.id,
      counts: [{ itemId: cement, countedQty: 5 }],
    });
    expect(variances[0].varianceQty).toBe(5);
    const placement = await prisma.stockPlacement.findFirstOrThrow({ where: { binId: bin.id } });
    expect(placement.quantity).toBe(5);
  });
});

describe("where the headline and the bins disagree", () => {
  it("lists the gap in size order", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    // Cement: 100 on hand, only 30 placed. Milk: 100 on hand, none placed.
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 30 });

    const gaps = await unplacedStock(tenantId);
    expect(gaps[0].name).toBe("Long life milk 1L");
    expect(gaps[0].differenceQty).toBe(100);
    expect(gaps[1].differenceQty).toBe(70);
  });

  it("says nothing when everything is placed", async () => {
    const bin = await saveBin({ tenantId, code: "A-01" });
    await putAway({ tenantId, binId: bin.id, itemId: cement, quantity: 100 });
    await putAway({ tenantId, binId: bin.id, itemId: milk, quantity: 100 });
    expect(await unplacedStock(tenantId)).toHaveLength(0);
  });
});
