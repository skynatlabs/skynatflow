// Is this thing real?
//
// The counterfeit problem here is not handbags. It is seed that does not
// germinate, fertiliser that is mostly sand, brake pads that are not, and
// engine oil that destroys the engine it is poured into. mPedigree solved
// this for pharmaceuticals two decades ago and nobody has done it for the
// inputs a farm or a workshop buys — which are the ones where a fake costs
// somebody a season or a life.
//
// The mechanism is old and works: a unique code under a scratch panel, the
// buyer checks it, and the answer comes back instantly. What makes it worth
// building rather than buying is what happens to the checks afterwards.
//
// EVERY CHECK IS KEPT, INCLUDING THE FAILURES. This is the part most
// implementations get wrong. A system that only records valid codes cannot
// see counterfeiting at all — a fake carries a code that is not in the
// database, so the check reads as "nothing happened". A hundred unknown
// codes from one town is a counterfeiter's distribution map, and it is only
// visible if the misses are recorded as carefully as the hits.
//
// A SECOND CHECK IS NOT AUTOMATICALLY FRAUD. A farmer checks a bag, then
// checks it again to show a neighbour. A mechanic checks at the counter and
// again at the car. So a repeat is reported as a repeat, with how many times
// and how far apart, and the judgement is left to a person. Calling the
// second check a counterfeit would make the product useless within a week.

import { prisma } from "@/lib/db";
import { haversineKm } from "./trips";

export type Verdict = "first" | "repeat" | "unknown" | "voided";

export interface CheckResult {
  verdict: Verdict;
  /** What to show the person holding the item, in their words not ours. */
  message: string;
  itemName?: string;
  firstCheckedAt?: Date;
  timesChecked?: number;
  /** How far from where it was first checked, when both are known. */
  kilometresFromFirstCheck?: number;
}

/** Make codes for a batch of product. */
export async function issueSerials(params: {
  tenantId: string;
  itemId: string;
  codes: string[];
  batchId?: string | null;
}): Promise<{ created: number; alreadyExisted: number }> {
  const item = await prisma.item.findFirst({
    where: { id: params.itemId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!item) throw new Error("That product is not in this workspace.");

  const clean = [...new Set(params.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (clean.length === 0) throw new Error("No codes were given.");

  const existing = await prisma.productSerial.findMany({
    where: { tenantId: params.tenantId, code: { in: clean } },
    select: { code: true },
    take: 20000,
  });
  const known = new Set(existing.map((e) => e.code));
  const fresh = clean.filter((c) => !known.has(c));

  if (fresh.length > 0) {
    await prisma.productSerial.createMany({
      data: fresh.map((code) => ({
        tenantId: params.tenantId,
        itemId: params.itemId,
        code,
        batchId: params.batchId ?? null,
      })),
    });
  }

  return { created: fresh.length, alreadyExisted: known.size };
}

/**
 * Somebody is standing in a shop holding a bag, asking whether it is real.
 *
 * Never throws, and always answers. A verification service that can return
 * an error is a verification service that a buyer stops trusting, and the
 * honest answer to "we cannot tell" is a sentence rather than a failure.
 */
export async function checkCode(params: {
  tenantId: string;
  code: string;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  at?: Date;
}): Promise<CheckResult> {
  const code = params.code.trim().toUpperCase();
  const at = params.at ?? new Date();

  const serial = code
    ? await prisma.productSerial.findFirst({
        where: { tenantId: params.tenantId, code },
        include: {
          item: { select: { name: true } },
          checks: { orderBy: { checkedAt: "asc" }, take: 20 },
        },
      })
    : null;

  let verdict: Verdict;
  let message: string;
  let kilometres: number | undefined;

  if (!serial) {
    verdict = "unknown";
    message =
      "This code is not one of ours. That does not always mean the product is fake — a code can be mistyped, and a scratch panel can be damaged — but check it carefully and ask the seller where it came from.";
  } else if (serial.isVoided) {
    verdict = "voided";
    message = `This code has been withdrawn${serial.voidedFor ? `: ${serial.voidedFor}` : "."} Do not use the product. Take it back to where you bought it.`;
  } else if (serial.checks.length === 0) {
    verdict = "first";
    message = `Genuine. This is the first time this code has been checked${serial.item ? `, and it is ${serial.item.name}` : ""}.`;
  } else {
    verdict = "repeat";
    const first = serial.checks[0];
    if (params.lat != null && params.lng != null && first.lat != null && first.lng != null) {
      kilometres = Math.round(haversineKm(first.lat, first.lng, params.lat, params.lng));
    }
    const days = Math.floor((at.getTime() - first.checkedAt.getTime()) / 86_400_000);
    message =
      `This code is one of ours, but it has been checked ${serial.checks.length} time${serial.checks.length === 1 ? "" : "s"} before` +
      (days > 0 ? `, first ${days} day${days === 1 ? "" : "s"} ago` : " already today") +
      (kilometres !== undefined && kilometres > 50 ? `, about ${kilometres}km from here` : "") +
      ". That is often just somebody checking twice — but if you have not checked it before, ask the seller.";
  }

  // Recorded whatever the answer, including unknown codes. The pattern in
  // the misses is the product.
  await prisma.productSerialCheck
    .create({
      data: {
        tenantId: params.tenantId,
        serialId: serial?.id ?? null,
        codeTried: code.slice(0, 64),
        verdict,
        lat: params.lat ?? null,
        lng: params.lng ?? null,
        checkedByPhone: params.phone?.trim().slice(0, 32) || null,
        checkedAt: at,
      },
    })
    .catch(() => {});

  return {
    verdict,
    message,
    itemName: serial?.item?.name,
    firstCheckedAt: serial?.checks[0]?.checkedAt,
    timesChecked: serial ? serial.checks.length + 1 : undefined,
    kilometresFromFirstCheck: kilometres,
  };
}

/** Withdraw a code — recalled, destroyed, or known compromised. */
export async function voidSerial(params: {
  tenantId: string;
  code: string;
  reason: string;
}) {
  const reason = params.reason.trim();
  if (!reason) throw new Error("A withdrawal needs a reason — the buyer is shown it.");

  const { count } = await prisma.productSerial.updateMany({
    where: { tenantId: params.tenantId, code: params.code.trim().toUpperCase() },
    data: { isVoided: true, voidedFor: reason.slice(0, 200) },
  });
  return { voided: count };
}

export interface FakeCluster {
  /** Roughly where, to one decimal place — about 11km. Never a doorstep. */
  approxLat: number;
  approxLng: number;
  unknownChecks: number;
  distinctCodes: number;
  lastSeen: Date;
}

export interface AuthenticityPicture {
  checksLast30: number;
  unknownLast30: number;
  repeatsLast30: number;
  unknownPercent: number;
  clusters: FakeCluster[];
  mostCheckedCodes: Array<{ code: string; times: number; itemName: string | null }>;
  summary: string;
}

/**
 * Where the fakes are.
 *
 * Clusters are reported to one decimal place of latitude and longitude,
 * which is roughly an eleven-kilometre square. That is deliberate: it is
 * enough to say "there is a problem around Kariakoo" and not enough to point
 * at a person's shop on the evidence of some failed scans, which would be a
 * serious accusation made by arithmetic.
 */
export async function authenticityPicture(
  tenantId: string,
  sinceDays = 30,
  now = new Date()
): Promise<AuthenticityPicture> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000);

  const checks = await prisma.productSerialCheck.findMany({
    where: { tenantId, checkedAt: { gte: since } },
    select: { verdict: true, lat: true, lng: true, codeTried: true, checkedAt: true, serialId: true },
    take: 50000,
  });

  const unknown = checks.filter((c) => c.verdict === "unknown");
  const repeats = checks.filter((c) => c.verdict === "repeat");

  const byCell = new Map<string, FakeCluster & { codes: Set<string> }>();
  for (const check of unknown) {
    if (check.lat == null || check.lng == null) continue;
    const lat = Math.round(check.lat * 10) / 10;
    const lng = Math.round(check.lng * 10) / 10;
    const key = `${lat},${lng}`;
    const cell =
      byCell.get(key) ??
      ({
        approxLat: lat,
        approxLng: lng,
        unknownChecks: 0,
        distinctCodes: 0,
        lastSeen: check.checkedAt,
        codes: new Set<string>(),
      } as FakeCluster & { codes: Set<string> });
    cell.unknownChecks += 1;
    cell.codes.add(check.codeTried);
    if (check.checkedAt > cell.lastSeen) cell.lastSeen = check.checkedAt;
    byCell.set(key, cell);
  }

  const clusters = [...byCell.values()]
    // One failed scan is a typo. Three from the same area is a pattern.
    .filter((c) => c.unknownChecks >= 3)
    .map(({ codes, ...c }) => ({ ...c, distinctCodes: codes.size }))
    .sort((a, b) => b.unknownChecks - a.unknownChecks)
    .slice(0, 50);

  const timesByCode = new Map<string, number>();
  for (const check of repeats) {
    timesByCode.set(check.codeTried, (timesByCode.get(check.codeTried) ?? 0) + 1);
  }
  const topCodes = [...timesByCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([code, times]) => ({ code, times, itemName: null as string | null }));

  if (topCodes.length > 0) {
    const serials = await prisma.productSerial.findMany({
      where: { tenantId, code: { in: topCodes.map((c) => c.code) } },
      select: { code: true, item: { select: { name: true } } },
      take: 100,
    });
    const nameOf = new Map(serials.map((s) => [s.code, s.item?.name ?? null]));
    for (const row of topCodes) row.itemName = nameOf.get(row.code) ?? null;
  }

  return {
    checksLast30: checks.length,
    unknownLast30: unknown.length,
    repeatsLast30: repeats.length,
    unknownPercent: checks.length === 0 ? 0 : Math.round((unknown.length / checks.length) * 100),
    clusters,
    mostCheckedCodes: topCodes,
    summary:
      checks.length === 0
        ? "Nobody has checked a code yet."
        : `${checks.length} checks, ${unknown.length} on codes that are not ours` +
          (clusters.length > 0 ? `, concentrated in ${clusters.length} area${clusters.length === 1 ? "" : "s"}.` : "."),
  };
}
