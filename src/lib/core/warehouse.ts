// Where things actually are.
//
// The difference between inventory and warehousing is one question: not "how
// many do we have" but "where are they, and in what order should somebody
// walk to get them". A business between a spreadsheet and SAP has the first
// number and never the second, so picking is done by whoever has been there
// longest, and when that person is off the whole operation slows down.
//
// Three things make this worth building rather than buying, in this market:
//
//   IT HAS TO SURVIVE A FULL SHIFT OFFLINE. A warehouse is a metal shed. The
//   general offline queue already carries changes with an idempotency key,
//   so this uses that rather than inventing a second way to be offline.
//
//   THE BIN IS THE TRUTH, NOT THE TOTAL. Item.stockQty stays the headline
//   number the rest of the app reads. Placements are where it is. They can
//   disagree — stock arrives and is not put away, or is moved and not
//   recorded — and the disagreement is reported rather than papered over,
//   because it is exactly what a cycle count exists to find.
//
//   EXPIRY BEATS LOCATION. When two bins hold the same thing, the one that
//   goes out is the one that expires first, even if it is further to walk.
//   A warehouse that picks by convenience writes off a pallet a quarter.

import { prisma } from "@/lib/db";

export interface BinInput {
  tenantId: string;
  binId?: string;
  code: string;
  branchId?: string | null;
  pickSequence?: number;
  isPickable?: boolean;
  note?: string | null;
}

export async function saveBin(input: BinInput) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("A bin needs a code.");

  const data = {
    code,
    branchId: input.branchId ?? null,
    pickSequence: Math.max(0, Math.round(input.pickSequence ?? 0)),
    ...(input.isPickable === undefined ? {} : { isPickable: input.isPickable }),
    note: input.note?.trim().slice(0, 200) || null,
  };

  if (input.binId) {
    const existing = await prisma.stockBin.findFirst({
      where: { id: input.binId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!existing) throw new Error("Bin not found.");
    return prisma.stockBin.update({ where: { id: input.binId }, data });
  }

  const clash = await prisma.stockBin.findFirst({
    where: { tenantId: input.tenantId, code },
    select: { id: true },
  });
  if (clash) throw new Error(`There is already a bin called ${code}.`);

  return prisma.stockBin.create({ data: { tenantId: input.tenantId, ...data } });
}

export async function listBins(tenantId: string) {
  return prisma.stockBin.findMany({
    where: { tenantId },
    orderBy: [{ pickSequence: "asc" }, { code: "asc" }],
    take: 2000,
    include: { _count: { select: { placements: true } } },
  });
}

/**
 * Put stock into a bin.
 *
 * Adds to whatever is there rather than replacing it, because putting away
 * is almost always an addition and a caller that meant to set an absolute
 * figure is doing a count, which has its own function and its own meaning.
 */
export async function putAway(params: {
  tenantId: string;
  binId: string;
  itemId: string;
  quantity: number;
  batchId?: string | null;
}) {
  const quantity = Math.round(params.quantity);
  if (quantity <= 0) throw new Error("Put away has to be for more than nothing.");

  const [bin, item] = await Promise.all([
    prisma.stockBin.findFirst({
      where: { id: params.binId, tenantId: params.tenantId },
      select: { id: true },
    }),
    prisma.item.findFirst({
      where: { id: params.itemId, tenantId: params.tenantId },
      select: { id: true },
    }),
  ]);
  if (!bin) throw new Error("Bin not found.");
  if (!item) throw new Error("That product is not in this workspace.");

  return prisma.stockPlacement.upsert({
    where: {
      binId_itemId_batchId: {
        binId: params.binId,
        itemId: params.itemId,
        batchId: params.batchId ?? "",
      },
    },
    create: {
      tenantId: params.tenantId,
      binId: params.binId,
      itemId: params.itemId,
      batchId: params.batchId ?? "",
      quantity,
    },
    update: { quantity: { increment: quantity } },
  });
}

/** Move stock from one bin to another, or fail without moving anything. */
export async function moveStock(params: {
  tenantId: string;
  fromBinId: string;
  toBinId: string;
  itemId: string;
  quantity: number;
  batchId?: string | null;
}) {
  const quantity = Math.round(params.quantity);
  if (quantity <= 0) throw new Error("A move has to be for more than nothing.");
  if (params.fromBinId === params.toBinId) throw new Error("That is the same bin.");

  const source = await prisma.stockPlacement.findFirst({
    where: {
      tenantId: params.tenantId,
      binId: params.fromBinId,
      itemId: params.itemId,
      batchId: params.batchId ?? "",
    },
  });
  if (!source) throw new Error("There is none of that in the bin you are moving from.");
  if (source.quantity < quantity) {
    throw new Error(`That bin only has ${source.quantity}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockPlacement.update({
      where: { id: source.id },
      data: { quantity: { decrement: quantity } },
    });
    await tx.stockPlacement.upsert({
      where: {
        binId_itemId_batchId: {
          binId: params.toBinId,
          itemId: params.itemId,
          batchId: params.batchId ?? "",
        },
      },
      create: {
        tenantId: params.tenantId,
        binId: params.toBinId,
        itemId: params.itemId,
        batchId: params.batchId ?? "",
        quantity,
      },
      update: { quantity: { increment: quantity } },
    });
  });

  return { moved: quantity };
}

export interface PickLine {
  itemId: string;
  quantity: number;
}

export interface PickInstruction {
  binCode: string;
  binId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  batchId: string | null;
  expiresAt: Date | null;
  pickSequence: number;
}

export interface PickList {
  instructions: PickInstruction[];
  /** Lines that could not be filled from bins, with how many are missing. */
  short: Array<{ itemId: string; itemName: string; wanted: number; found: number }>;
  bins: number;
  summary: string;
}

/**
 * Where to walk, and in what order.
 *
 * Within one product the rule is expiry first, then pick sequence: a pallet
 * that goes out of date next month is sent before one that goes out of date
 * next year, even when it is further to walk. Across products the whole list
 * is sorted by pick sequence, so the walk is one pass through the building
 * rather than a tour dictated by the order somebody typed the lines.
 */
export async function buildPickList(params: {
  tenantId: string;
  lines: PickLine[];
}): Promise<PickList> {
  const itemIds = params.lines.map((l) => l.itemId);

  const [placements, batches, items] = await Promise.all([
    prisma.stockPlacement.findMany({
      where: {
        tenantId: params.tenantId,
        itemId: { in: itemIds },
        quantity: { gt: 0 },
        bin: { isPickable: true },
      },
      include: { bin: { select: { id: true, code: true, pickSequence: true } } },
      take: 5000,
    }),
    prisma.itemBatch.findMany({
      where: { tenantId: params.tenantId, itemId: { in: itemIds } },
      select: { id: true, expiresAt: true },
      take: 5000,
    }),
    prisma.item.findMany({
      where: { tenantId: params.tenantId, id: { in: itemIds } },
      select: { id: true, name: true },
      take: 1000,
    }),
  ]);

  const expiryOf = new Map(batches.map((b) => [b.id, b.expiresAt]));
  const nameOf = new Map(items.map((i) => [i.id, i.name]));

  const instructions: PickInstruction[] = [];
  const short: PickList["short"] = [];

  for (const line of params.lines) {
    const wanted = Math.round(line.quantity);
    if (wanted <= 0) continue;

    const candidates = placements
      .filter((p) => p.itemId === line.itemId)
      .sort((a, b) => {
        const aExpiry = a.batchId ? expiryOf.get(a.batchId) ?? null : null;
        const bExpiry = b.batchId ? expiryOf.get(b.batchId) ?? null : null;
        // Something that expires always goes before something that does not.
        if (aExpiry && bExpiry) return aExpiry.getTime() - bExpiry.getTime();
        if (aExpiry) return -1;
        if (bExpiry) return 1;
        return a.bin.pickSequence - b.bin.pickSequence || a.bin.code.localeCompare(b.bin.code);
      });

    let left = wanted;
    for (const placement of candidates) {
      if (left <= 0) break;
      const take = Math.min(left, placement.quantity);
      instructions.push({
        binCode: placement.bin.code,
        binId: placement.bin.id,
        itemId: placement.itemId,
        itemName: nameOf.get(placement.itemId) ?? "Unknown",
        quantity: take,
        batchId: placement.batchId,
        expiresAt: placement.batchId ? expiryOf.get(placement.batchId) ?? null : null,
        pickSequence: placement.bin.pickSequence,
      });
      left -= take;
    }

    if (left > 0) {
      short.push({
        itemId: line.itemId,
        itemName: nameOf.get(line.itemId) ?? "Unknown",
        wanted,
        found: wanted - left,
      });
    }
  }

  instructions.sort(
    (a, b) => a.pickSequence - b.pickSequence || a.binCode.localeCompare(b.binCode)
  );

  return {
    instructions,
    short,
    bins: new Set(instructions.map((i) => i.binId)).size,
    summary:
      instructions.length === 0
        ? "Nothing could be picked — no stock is placed in any pickable bin."
        : `${instructions.length} pick${instructions.length === 1 ? "" : "s"} across ${new Set(instructions.map((i) => i.binId)).size} bins` +
          (short.length > 0 ? `, ${short.length} line${short.length === 1 ? "" : "s"} short.` : "."),
  };
}

/** Take stock off a bin after it has been picked. */
export async function confirmPick(params: {
  tenantId: string;
  binId: string;
  itemId: string;
  quantity: number;
  batchId?: string | null;
}) {
  const placement = await prisma.stockPlacement.findFirst({
    where: {
      tenantId: params.tenantId,
      binId: params.binId,
      itemId: params.itemId,
      batchId: params.batchId ?? "",
    },
  });
  if (!placement) throw new Error("There is none of that in that bin.");

  const quantity = Math.round(params.quantity);
  if (quantity > placement.quantity) {
    throw new Error(`That bin only has ${placement.quantity}.`);
  }

  return prisma.stockPlacement.update({
    where: { id: placement.id },
    data: { quantity: { decrement: quantity } },
  });
}

export interface CountLine {
  itemId: string;
  itemName: string;
  binCode: string;
  systemQty: number;
  countedQty: number;
  varianceQty: number;
}

/**
 * A cycle count on one bin.
 *
 * Sets the bin to what was counted and reports what changed, rather than
 * adjusting quietly. A count that silently corrects itself teaches nobody
 * anything, and the whole value of counting a bin every week instead of the
 * whole warehouse once a year is finding out *which* bin drifts.
 */
export async function countBin(params: {
  tenantId: string;
  binId: string;
  counts: Array<{ itemId: string; batchId?: string | null; countedQty: number }>;
}): Promise<CountLine[]> {
  const bin = await prisma.stockBin.findFirst({
    where: { id: params.binId, tenantId: params.tenantId },
    select: { id: true, code: true },
  });
  if (!bin) throw new Error("Bin not found.");

  const existing = await prisma.stockPlacement.findMany({
    where: { tenantId: params.tenantId, binId: params.binId },
    include: { item: { select: { name: true } } },
    take: 1000,
  });

  const out: CountLine[] = [];
  const now = new Date();

  for (const count of params.counts) {
    const counted = Math.max(0, Math.round(count.countedQty));
    const batchId = count.batchId ?? "";
    const match = existing.find((e) => e.itemId === count.itemId && e.batchId === batchId);
    const systemQty = match?.quantity ?? 0;

    if (match) {
      await prisma.stockPlacement.update({
        where: { id: match.id },
        data: { quantity: counted, countedAt: now },
      });
    } else if (counted > 0) {
      const item = await prisma.item.findFirst({
        where: { id: count.itemId, tenantId: params.tenantId },
        select: { id: true, name: true },
      });
      if (!item) continue;
      await prisma.stockPlacement.create({
        data: {
          tenantId: params.tenantId,
          binId: params.binId,
          itemId: count.itemId,
          batchId,
          quantity: counted,
          countedAt: now,
        },
      });
    }

    out.push({
      itemId: count.itemId,
      itemName: match?.item.name ?? "Unknown",
      binCode: bin.code,
      systemQty,
      countedQty: counted,
      varianceQty: counted - systemQty,
    });
  }

  return out.filter((line) => line.varianceQty !== 0);
}

export interface PlacementGap {
  itemId: string;
  name: string;
  stockQty: number;
  placedQty: number;
  differenceQty: number;
}

/**
 * Where the headline number and the bins disagree.
 *
 * They will, and that is not a bug: stock arrives and is not put away, or is
 * moved and not recorded. Reporting the difference is the point — it is the
 * list a cycle count should work through, in size order.
 */
export async function unplacedStock(tenantId: string): Promise<PlacementGap[]> {
  const [items, placements] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, stockQty: { not: null } },
      select: { id: true, name: true, stockQty: true },
      take: 5000,
    }),
    prisma.stockPlacement.groupBy({
      by: ["itemId"],
      where: { tenantId },
      _sum: { quantity: true },
    }),
  ]);

  const placedOf = new Map(placements.map((p) => [p.itemId, p._sum.quantity ?? 0]));

  return items
    .map((item) => {
      const placed = placedOf.get(item.id) ?? 0;
      return {
        itemId: item.id,
        name: item.name,
        stockQty: item.stockQty ?? 0,
        placedQty: placed,
        differenceQty: (item.stockQty ?? 0) - placed,
      };
    })
    .filter((row) => row.differenceQty !== 0)
    .sort((a, b) => Math.abs(b.differenceQty) - Math.abs(a.differenceQty))
    .slice(0, 200);
}
