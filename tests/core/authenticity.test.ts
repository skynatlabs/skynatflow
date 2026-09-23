// The misses are the product. A system that only records valid codes cannot
// see counterfeiting at all, because a fake carries a code that is not in
// the database. So the tests defend two things: every check is recorded
// including the failures, and a second check is reported as a second check
// rather than called fraud.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  issueSerials,
  checkCode,
  voidSerial,
  authenticityPicture,
} from "../../src/lib/core/authenticity";

let tenantId: string;
let seedId: string;

const NAIROBI = { lat: -1.2921, lng: 36.8219 };
const MOMBASA = { lat: -4.0435, lng: 39.6682 };

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Authenticity Test Seed Co", niche: "WHOLESALE" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.productSerialCheck.deleteMany({ where: { tenantId } });
  await prisma.productSerial.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.productSerialCheck.deleteMany({ where: { tenantId } });
  await prisma.productSerial.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  const item = await prisma.item.create({
    data: { tenantId, name: "Hybrid maize seed 2kg", unitPriceCents: 45000 },
  });
  seedId = item.id;
});

describe("issuing codes", () => {
  it("creates them, upper-cased and deduplicated", async () => {
    const result = await issueSerials({ tenantId, itemId: seedId, codes: ["ab-1", "AB-1", "cd-2"] });
    expect(result.created).toBe(2);
    const codes = await prisma.productSerial.findMany({ where: { tenantId }, select: { code: true } });
    expect(codes.map((c) => c.code).sort()).toEqual(["AB-1", "CD-2"]);
  });

  it("does not create one twice", async () => {
    await issueSerials({ tenantId, itemId: seedId, codes: ["AB-1"] });
    const second = await issueSerials({ tenantId, itemId: seedId, codes: ["AB-1", "AB-2"] });
    expect(second.created).toBe(1);
    expect(second.alreadyExisted).toBe(1);
  });

  it("refuses a product from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "RETAIL" } });
    const theirs = await prisma.item.create({
      data: { tenantId: other.id, name: "Theirs", unitPriceCents: 0 },
    });
    await expect(
      issueSerials({ tenantId, itemId: theirs.id, codes: ["X"] })
    ).rejects.toThrow(/not in this workspace/i);
    await prisma.item.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe("somebody standing in a shop", () => {
  beforeEach(async () => {
    await issueSerials({ tenantId, itemId: seedId, codes: ["REAL-1"] });
  });

  it("confirms a genuine code on its first check", async () => {
    const result = await checkCode({ tenantId, code: "real-1" });
    expect(result.verdict).toBe("first");
    expect(result.message).toMatch(/genuine/i);
    expect(result.message).toContain("Hybrid maize seed 2kg");
  });

  it("reports a second check as a second check, not as fraud", async () => {
    await checkCode({ tenantId, code: "REAL-1" });
    const second = await checkCode({ tenantId, code: "REAL-1" });
    expect(second.verdict).toBe("repeat");
    expect(second.message).toMatch(/often just somebody checking twice/i);
    expect(second.message).not.toMatch(/fake|counterfeit|fraud/i);
  });

  it("mentions the distance when a repeat comes from far away", async () => {
    await checkCode({ tenantId, code: "REAL-1", ...NAIROBI });
    const second = await checkCode({ tenantId, code: "REAL-1", ...MOMBASA });
    expect(second.kilometresFromFirstCheck).toBeGreaterThan(400);
    expect(second.message).toMatch(/km from here/);
  });

  it("does not say a code it has never seen is definitely fake", async () => {
    const result = await checkCode({ tenantId, code: "NOT-OURS" });
    expect(result.verdict).toBe("unknown");
    expect(result.message).toMatch(/not one of ours/i);
    expect(result.message).toMatch(/mistyped|damaged/i);
  });

  it("tells somebody to stop using a withdrawn code", async () => {
    await voidSerial({ tenantId, code: "REAL-1", reason: "recalled — germination failure" });
    const result = await checkCode({ tenantId, code: "REAL-1" });
    expect(result.verdict).toBe("voided");
    expect(result.message).toMatch(/do not use/i);
    expect(result.message).toMatch(/germination failure/);
  });

  it("insists a withdrawal has a reason, because the buyer is shown it", async () => {
    await expect(voidSerial({ tenantId, code: "REAL-1", reason: " " })).rejects.toThrow(/reason/i);
  });

  it("answers rather than failing on an empty code", async () => {
    const result = await checkCode({ tenantId, code: "   " });
    expect(result.verdict).toBe("unknown");
  });

  it("records the failures as carefully as the hits", async () => {
    await checkCode({ tenantId, code: "REAL-1" });
    await checkCode({ tenantId, code: "FAKE-1" });
    await checkCode({ tenantId, code: "FAKE-2" });

    const checks = await prisma.productSerialCheck.findMany({ where: { tenantId } });
    expect(checks).toHaveLength(3);
    expect(checks.filter((c) => c.verdict === "unknown")).toHaveLength(2);
  });
});

describe("where the fakes are", () => {
  it("clusters unknown checks without pointing at a doorstep", async () => {
    for (let i = 0; i < 5; i++) {
      await checkCode({ tenantId, code: `FAKE-${i}`, ...NAIROBI });
    }
    const picture = await authenticityPicture(tenantId, 30);
    expect(picture.clusters).toHaveLength(1);
    expect(picture.clusters[0].unknownChecks).toBe(5);
    expect(picture.clusters[0].distinctCodes).toBe(5);
    // One decimal place is about eleven kilometres, never a shop.
    expect(picture.clusters[0].approxLat).toBe(-1.3);
  });

  it("treats one or two failed scans as a typo, not a pattern", async () => {
    await checkCode({ tenantId, code: "FAKE-1", ...NAIROBI });
    await checkCode({ tenantId, code: "FAKE-2", ...NAIROBI });
    const picture = await authenticityPicture(tenantId, 30);
    expect(picture.clusters).toHaveLength(0);
    expect(picture.unknownLast30).toBe(2);
  });

  it("reports the share of checks that hit nothing", async () => {
    await issueSerials({ tenantId, itemId: seedId, codes: ["REAL-1"] });
    await checkCode({ tenantId, code: "REAL-1" });
    await checkCode({ tenantId, code: "FAKE-1" });
    await checkCode({ tenantId, code: "FAKE-2" });
    await checkCode({ tenantId, code: "FAKE-3" });

    const picture = await authenticityPicture(tenantId, 30);
    expect(picture.unknownPercent).toBe(75);
    expect(picture.summary).toMatch(/not ours/i);
  });

  it("names the codes checked most often", async () => {
    await issueSerials({ tenantId, itemId: seedId, codes: ["REAL-1"] });
    for (let i = 0; i < 4; i++) await checkCode({ tenantId, code: "REAL-1" });

    const picture = await authenticityPicture(tenantId, 30);
    expect(picture.mostCheckedCodes[0].code).toBe("REAL-1");
    expect(picture.mostCheckedCodes[0].times).toBe(3);
    expect(picture.mostCheckedCodes[0].itemName).toBe("Hybrid maize seed 2kg");
  });

  it("says so plainly when nobody has checked anything", async () => {
    const picture = await authenticityPicture(tenantId, 30);
    expect(picture.summary).toMatch(/nobody has checked/i);
  });
});
