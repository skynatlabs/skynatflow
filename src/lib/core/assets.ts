// The asset register — who has which laptop, drill, phone or vehicle.
//
// Small businesses lose equipment continuously and notice annually, usually
// when somebody leaves and nobody can say what they had. The fix is not a
// better spreadsheet, it is that issuing and returning are recorded as events
// rather than as a field somebody overwrites: "who had the drill in March" is
// asked in June, and a current-holder column cannot answer it.
//
// It also feeds two other things. Depreciation needs a purchase price and a
// life, which is why they live here rather than being typed twice. And a
// handover pack is largely a list of what somebody is still holding.

import { prisma } from "@/lib/db";
import { AssetStatus } from "@prisma/client";

export interface CreateAssetParams {
  tenantId: string;
  name: string;
  category?: string | null;
  serial?: string | null;
  purchasedOn?: Date | null;
  purchaseCents?: number | null;
  usefulLifeMonths?: number | null;
  notes?: string | null;
}

export async function createAsset(params: CreateAssetParams) {
  const name = params.name.trim();
  if (!name) throw new Error("Give the asset a name.");

  return prisma.asset.create({
    data: {
      tenantId: params.tenantId,
      name,
      category: params.category?.trim() || null,
      serial: params.serial?.trim() || null,
      purchasedOn: params.purchasedOn ?? null,
      purchaseCents: params.purchaseCents ?? null,
      usefulLifeMonths: params.usefulLifeMonths ?? null,
      notes: params.notes?.trim() || null,
    },
  });
}

async function requireOwned(tenantId: string, assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.tenantId !== tenantId) throw new Error("Asset not found.");
  return asset;
}

async function requireMember(tenantId: string, membershipId: string) {
  const member = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { tenantId: true },
  });
  if (!member || member.tenantId !== tenantId) throw new Error("Team member not found.");
}

/**
 * Give an asset to somebody.
 *
 * The movement is written in the same transaction as the status change, so a
 * crash cannot leave an asset showing as issued with no record of to whom —
 * which is precisely the state the register exists to prevent.
 */
export async function issueAsset(params: {
  tenantId: string;
  assetId: string;
  toMembershipId: string;
  note?: string;
}) {
  const asset = await requireOwned(params.tenantId, params.assetId);
  await requireMember(params.tenantId, params.toMembershipId);

  if (asset.status === AssetStatus.RETIRED) {
    throw new Error("That asset has been retired — it can't be issued.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.assetMovement.create({
      data: {
        assetId: asset.id,
        tenantId: params.tenantId,
        fromId: asset.holderId,
        toId: params.toMembershipId,
        kind: "issued",
        note: params.note ?? null,
      },
    });
    return tx.asset.update({
      where: { id: asset.id },
      data: {
        status: AssetStatus.ISSUED,
        holderId: params.toMembershipId,
        issuedAt: new Date(),
      },
    });
  });
}

export async function returnAsset(params: {
  tenantId: string;
  assetId: string;
  note?: string;
  /** Came back broken. */
  toRepair?: boolean;
}) {
  const asset = await requireOwned(params.tenantId, params.assetId);

  return prisma.$transaction(async (tx) => {
    await tx.assetMovement.create({
      data: {
        assetId: asset.id,
        tenantId: params.tenantId,
        fromId: asset.holderId,
        toId: null,
        kind: params.toRepair ? "repair" : "returned",
        note: params.note ?? null,
      },
    });
    return tx.asset.update({
      where: { id: asset.id },
      data: {
        status: params.toRepair ? AssetStatus.IN_REPAIR : AssetStatus.IN_STOCK,
        holderId: null,
        issuedAt: null,
      },
    });
  });
}

/**
 * Take an asset out of service.
 *
 * Never a delete. An asset that was sold, scrapped or lost is part of what
 * happened, and deleting it takes its whole movement history with it.
 */
export async function retireAsset(params: {
  tenantId: string;
  assetId: string;
  lost?: boolean;
  note?: string;
}) {
  const asset = await requireOwned(params.tenantId, params.assetId);

  return prisma.$transaction(async (tx) => {
    await tx.assetMovement.create({
      data: {
        assetId: asset.id,
        tenantId: params.tenantId,
        fromId: asset.holderId,
        toId: null,
        kind: params.lost ? "lost" : "retired",
        note: params.note ?? null,
      },
    });
    return tx.asset.update({
      where: { id: asset.id },
      data: {
        status: params.lost ? AssetStatus.LOST : AssetStatus.RETIRED,
        holderId: null,
        issuedAt: null,
      },
    });
  });
}

export async function listAssets(
  tenantId: string,
  opts: { status?: AssetStatus; holderId?: string } = {}
) {
  return prisma.asset.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.holderId ? { holderId: opts.holderId } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      holder: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });
}

export async function assetHistory(tenantId: string, assetId: string) {
  await requireOwned(tenantId, assetId);
  return prisma.assetMovement.findMany({
    where: { assetId },
    orderBy: { at: "desc" },
  });
}

export interface AssetSummary {
  total: number;
  issued: number;
  inStock: number;
  inRepair: number;
  lost: number;
  /** What the register says the business owns, at cost. */
  valueAtCostCents: number;
  /** Assets with no purchase price, so the value above understates reality. */
  missingValue: number;
  summary: string;
}

export async function assetSummary(tenantId: string): Promise<AssetSummary> {
  const assets = await prisma.asset.findMany({
    where: { tenantId },
    select: { status: true, purchaseCents: true },
  });

  const live = assets.filter((a) => a.status !== AssetStatus.RETIRED);
  const count = (s: AssetStatus) => assets.filter((a) => a.status === s).length;

  const valueAtCostCents = live.reduce((sum, a) => sum + (a.purchaseCents ?? 0), 0);
  const missingValue = live.filter((a) => a.purchaseCents === null).length;
  const lost = count(AssetStatus.LOST);

  const parts: string[] = [];
  if (lost > 0) {
    // Lost equipment leads, because it is the number that should prompt a
    // conversation rather than a nod.
    parts.push(`${lost} item${lost === 1 ? "" : "s"} recorded as lost`);
  }
  if (missingValue > 0) {
    parts.push(`${missingValue} with no purchase price recorded`);
  }

  return {
    total: live.length,
    issued: count(AssetStatus.ISSUED),
    inStock: count(AssetStatus.IN_STOCK),
    inRepair: count(AssetStatus.IN_REPAIR),
    lost,
    valueAtCostCents,
    missingValue,
    summary: parts.length > 0 ? `${parts.join(", ")}.` : "",
  };
}

/** Everything a particular person is currently holding. */
export async function assetsHeldBy(tenantId: string, membershipId: string) {
  return prisma.asset.findMany({
    where: { tenantId, holderId: membershipId, status: AssetStatus.ISSUED },
    orderBy: { name: "asc" },
  });
}
