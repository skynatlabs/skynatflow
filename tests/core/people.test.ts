// Assets, leave and handover packs.
//
// The interesting behaviour is not the happy path. It is that an asset's
// history survives a change of holder, that leave days do not silently
// restate when the holiday list changes, and that a handover pack is built
// from what somebody touched rather than from what they remember.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  assetSummary,
  assetHistory,
  assetsHeldBy,
  createAsset,
  issueAsset,
  listAssets,
  retireAsset,
  returnAsset,
} from "../../src/lib/core/assets";
import {
  addHoliday,
  decideLeave,
  leaveBalances,
  requestLeave,
  whoIsAway,
  workingDaysBetween,
} from "../../src/lib/core/people";
import { buildHandoverPack } from "../../src/lib/core/handover";

let tenantId: string;
let aliceId: string;
let bobId: string;
const userIds: string[] = [];

async function member(name: string) {
  const u = await prisma.user.create({
    data: { email: `${name}-${Date.now()}-${Math.round(performance.now())}@test.local`, name },
  });
  userIds.push(u.id);
  const m = await prisma.membership.create({
    data: { tenantId, userId: u.id, role: "STAFF" },
  });
  return m.id;
}

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "People Co", niche: "SERVICES" } });
  tenantId = t.id;
  userIds.length = 0;
  aliceId = await member("Alice");
  bobId = await member("Bob");
});

afterEach(async () => {
  await prisma.assetMovement.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.leaveRequest.deleteMany({ where: { tenantId } });
  await prisma.holiday.deleteMany({ where: { tenantId } });
  await prisma.employmentRecord.deleteMany({ where: { tenantId } });
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.transaction.deleteMany({ where: { tenantId } });
  await prisma.item.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
});

// ------------------------------------------------------------------ assets

describe("the asset register", () => {
  it("keeps the whole history, not just who has it now", async () => {
    const asset = await createAsset({ tenantId, name: "Hilti drill", category: "power tool" });

    await issueAsset({ tenantId, assetId: asset.id, toMembershipId: aliceId });
    await returnAsset({ tenantId, assetId: asset.id });
    await issueAsset({ tenantId, assetId: asset.id, toMembershipId: bobId });

    // "Who had the drill in March" is asked in June, and a current-holder
    // column cannot answer it.
    const history = await assetHistory(tenantId, asset.id);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.kind)).toEqual(["issued", "returned", "issued"]);
    expect(history[0].toId).toBe(bobId);

    const held = await assetsHeldBy(tenantId, bobId);
    expect(held.map((a) => a.name)).toEqual(["Hilti drill"]);
    expect(await assetsHeldBy(tenantId, aliceId)).toHaveLength(0);
  });

  it("retires rather than deletes, keeping the trail", async () => {
    const asset = await createAsset({ tenantId, name: "Old laptop" });
    await issueAsset({ tenantId, assetId: asset.id, toMembershipId: aliceId });
    await retireAsset({ tenantId, assetId: asset.id, note: "Sold" });

    const row = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(row!.status).toBe("RETIRED");
    expect(row!.holderId).toBeNull();
    expect(await assetHistory(tenantId, asset.id)).toHaveLength(2);
  });

  it("will not issue something already retired", async () => {
    const asset = await createAsset({ tenantId, name: "Scrapped bakkie" });
    await retireAsset({ tenantId, assetId: asset.id });
    await expect(
      issueAsset({ tenantId, assetId: asset.id, toMembershipId: aliceId })
    ).rejects.toThrow(/retired/);
  });

  it("will not issue to somebody from another workspace", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other", niche: "SERVICES" } });
    const u = await prisma.user.create({ data: { email: `x-${other.id}@test.local`, name: "X" } });
    const theirs = await prisma.membership.create({
      data: { tenantId: other.id, userId: u.id, role: "STAFF" },
    });
    const asset = await createAsset({ tenantId, name: "Laptop" });

    await expect(
      issueAsset({ tenantId, assetId: asset.id, toMembershipId: theirs.id })
    ).rejects.toThrow(/not found/);

    await prisma.membership.delete({ where: { id: theirs.id } });
    await prisma.user.delete({ where: { id: u.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });

  it("leads with lost equipment and admits what it cannot value", async () => {
    await createAsset({ tenantId, name: "Priced", purchaseCents: 50_000 });
    await createAsset({ tenantId, name: "Unpriced" });
    const lost = await createAsset({ tenantId, name: "Gone" });
    await retireAsset({ tenantId, assetId: lost.id, lost: true });

    const s = await assetSummary(tenantId);
    expect(s.lost).toBe(1);
    expect(s.missingValue).toBe(2); // the unpriced one and the lost one
    expect(s.summary).toContain("recorded as lost");
    expect(s.summary).toContain("no purchase price");
  });

  it("excludes retired assets from what the business owns", async () => {
    const a = await createAsset({ tenantId, name: "Sold", purchaseCents: 100_000 });
    await createAsset({ tenantId, name: "Kept", purchaseCents: 40_000 });
    await retireAsset({ tenantId, assetId: a.id });

    const s = await assetSummary(tenantId);
    expect(s.total).toBe(1);
    expect(s.valueAtCostCents).toBe(40_000);
  });

  it("filters the list by who is holding", async () => {
    const one = await createAsset({ tenantId, name: "One" });
    await createAsset({ tenantId, name: "Two" });
    await issueAsset({ tenantId, assetId: one.id, toMembershipId: aliceId });

    expect((await listAssets(tenantId, { holderId: aliceId })).map((a) => a.name)).toEqual(["One"]);
    expect((await listAssets(tenantId, { status: "IN_STOCK" })).map((a) => a.name)).toEqual(["Two"]);
  });
});

// ------------------------------------------------------------------- leave

describe("working days", () => {
  it("skips weekends", () => {
    // Mon 2 Mar to Fri 6 Mar 2026 is five working days.
    const days = workingDaysBetween(
      new Date("2026-03-02T00:00:00Z"),
      new Date("2026-03-06T00:00:00Z"),
      []
    );
    expect(days).toBe(5);
  });

  it("skips public holidays", () => {
    const days = workingDaysBetween(
      new Date("2026-03-02T00:00:00Z"),
      new Date("2026-03-06T00:00:00Z"),
      [new Date("2026-03-04T00:00:00Z")]
    );
    expect(days).toBe(4);
  });

  it("counts a single working day as one", () => {
    expect(
      workingDaysBetween(new Date("2026-03-03T00:00:00Z"), new Date("2026-03-03T00:00:00Z"), [])
    ).toBe(1);
  });

  it("returns zero when the range is backwards", () => {
    expect(
      workingDaysBetween(new Date("2026-03-06T00:00:00Z"), new Date("2026-03-02T00:00:00Z"), [])
    ).toBe(0);
  });
});

describe("leave", () => {
  it("stores the day count so a later holiday change cannot restate it", async () => {
    const req = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2026-03-02T00:00:00Z"),
      endOn: new Date("2026-03-06T00:00:00Z"),
    });
    expect(req.days).toBe(5);

    // Somebody adds a holiday inside a period already approved and taken.
    await addHoliday({ tenantId, name: "Declared later", onDate: new Date("2026-03-04T00:00:00Z") });

    const after = await prisma.leaveRequest.findUnique({ where: { id: req.id } });
    expect(after!.days).toBe(5);
  });

  it("refuses a range with no working days in it", async () => {
    await expect(
      requestLeave({
        tenantId,
        membershipId: aliceId,
        // A Saturday and Sunday.
        startOn: new Date("2026-03-07T00:00:00Z"),
        endOn: new Date("2026-03-08T00:00:00Z"),
      })
    ).rejects.toThrow(/no working days/);
  });

  it("separates days already gone from days still booked", async () => {
    const past = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2026-01-05T00:00:00Z"),
      endOn: new Date("2026-01-06T00:00:00Z"),
    });
    await decideLeave({ tenantId, leaveRequestId: past.id, approve: true, decidedById: bobId });

    const future = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2099-06-01T00:00:00Z"),
      endOn: new Date("2099-06-03T00:00:00Z"),
    });
    await decideLeave({ tenantId, leaveRequestId: future.id, approve: true, decidedById: bobId });

    const balances = await leaveBalances(tenantId, { year: 2026 });
    const alice = balances.find((b) => b.membershipId === aliceId)!;
    expect(alice.takenDays).toBe(2);
    // The 2099 request is outside the 2026 leave year, so it is not counted.
    expect(alice.bookedDays).toBe(0);
    expect(alice.remainingDays).toBe(13);
  });

  it("will not decide the same request twice", async () => {
    const req = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2026-04-06T00:00:00Z"),
      endOn: new Date("2026-04-07T00:00:00Z"),
    });
    await decideLeave({ tenantId, leaveRequestId: req.id, approve: true, decidedById: bobId });
    await expect(
      decideLeave({ tenantId, leaveRequestId: req.id, approve: false, decidedById: bobId })
    ).rejects.toThrow(/already been decided/);
  });

  it("answers who is away, including leave spanning the whole window", async () => {
    const req = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2026-05-04T00:00:00Z"),
      endOn: new Date("2026-05-22T00:00:00Z"),
    });
    await decideLeave({ tenantId, leaveRequestId: req.id, approve: true, decidedById: bobId });

    // A week sitting entirely inside her leave. The naive query — requests
    // starting within the window — would miss this.
    const away = await whoIsAway(
      tenantId,
      new Date("2026-05-11T00:00:00Z"),
      new Date("2026-05-15T00:00:00Z")
    );
    expect(away.map((a) => a.name)).toEqual(["Alice"]);
  });

  it("does not report somebody whose request was declined", async () => {
    const req = await requestLeave({
      tenantId,
      membershipId: aliceId,
      startOn: new Date("2026-05-04T00:00:00Z"),
      endOn: new Date("2026-05-08T00:00:00Z"),
    });
    await decideLeave({ tenantId, leaveRequestId: req.id, approve: false, decidedById: bobId });

    const away = await whoIsAway(
      tenantId,
      new Date("2026-05-04T00:00:00Z"),
      new Date("2026-05-08T00:00:00Z")
    );
    expect(away).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- handover

describe("handover packs", () => {
  it("is built from what somebody held and touched", async () => {
    const drill = await createAsset({ tenantId, name: "Hilti drill" });
    await issueAsset({ tenantId, assetId: drill.id, toMembershipId: aliceId });

    const customer = await prisma.party.create({
      data: { tenantId, name: "Only Alice Ltd", role: "CUSTOMER" },
    });
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId: customer.id,
        type: "QUOTE",
        status: "SENT",
        amountCents: 250_000,
        salesPersonMembershipId: aliceId,
      },
    });
    await prisma.task.create({
      data: { tenantId, title: "Finish the Mkhize install", assigneeId: aliceId, status: "TODO" },
    });

    const pack = await buildHandoverPack({ tenantId, membershipId: aliceId });

    expect(pack.summary).toContain("1 piece of equipment");
    expect(pack.summary).toContain("1 open quote");
    expect(pack.summary).toContain("1 unfinished job");

    const kinds = pack.items.map((i) => i.kind);
    expect(kinds).toContain("asset");
    expect(kinds).toContain("quote");
    expect(kinds).toContain("job");
    // The customer nobody else has spoken to is the knowledge that actually
    // walks out of the door.
    expect(kinds).toContain("customer");

    // Equipment, open money and unfinished work block; context does not.
    expect(pack.blockingCount).toBe(3);
    expect(pack.caveats.length).toBeGreaterThan(0);
  });

  it("does not flag a customer other people also deal with", async () => {
    const shared = await prisma.party.create({
      data: { tenantId, name: "Shared Ltd", role: "CUSTOMER" },
    });
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId: shared.id,
        type: "QUOTE",
        status: "ACCEPTED",
        amountCents: 100_000,
        salesPersonMembershipId: aliceId,
      },
    });
    await prisma.transaction.create({
      data: {
        tenantId,
        partyId: shared.id,
        type: "INVOICE",
        status: "PAID",
        amountCents: 100_000,
        salesPersonMembershipId: bobId,
      },
    });

    const pack = await buildHandoverPack({ tenantId, membershipId: aliceId });
    expect(pack.items.filter((i) => i.kind === "customer")).toHaveLength(0);
  });

  it("says plainly when there is nothing to hand over", async () => {
    const pack = await buildHandoverPack({ tenantId, membershipId: bobId });
    expect(pack.summary).toContain("nothing outstanding");
    expect(pack.blockingCount).toBe(0);
  });

  it("will not build a pack for another workspace's person", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other H", niche: "SERVICES" } });
    await expect(
      buildHandoverPack({ tenantId: other.id, membershipId: aliceId })
    ).rejects.toThrow(/not found/);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
