// A rider's bag is a till and a refused delivery is a countable event. The
// tests that matter: a rider is answerable for money they took and never for
// a customer who refused to pay, every failed try is recorded, and a
// reliability score says nothing at all until there is enough history for it
// to mean something.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DeliveryOutcome, PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  openRiderBag,
  assignToRider,
  recordAttempt,
  closeRiderBag,
  ridersHolding,
  buyerReliability,
  codPicture,
  MIN_DELIVERIES_TO_SCORE,
} from "../../src/lib/core/cod";

let tenantId: string;
let riderId: string;
let userId: string;
let buyerId: string;
let counter = 0;

async function note(partyId: string, codCents: number | null = 15000) {
  counter += 1;
  const created = await prisma.deliveryNote.create({
    data: {
      tenantId,
      number: `DN-${Date.now()}-${counter}`,
      partyId,
      codAmountCents: codCents,
    },
  });
  return created.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "COD Test Courier", niche: "LOGISTICS" } });
  tenantId = tenant.id;
  const user = await prisma.user.create({ data: { email: `rider-${tenant.id}@example.test`, name: "Bongani Zulu" } });
  userId = user.id;
  riderId = (await prisma.membership.create({ data: { tenantId, userId, role: "DRIVER" } })).id;
});

afterAll(async () => {
  await prisma.deliveryAttempt.deleteMany({ where: { tenantId } });
  await prisma.deliveryNoteLine.deleteMany({ where: { note: { tenantId } } });
  await prisma.deliveryNote.deleteMany({ where: { tenantId } });
  await prisma.codSettlement.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

beforeEach(async () => {
  await prisma.deliveryAttempt.deleteMany({ where: { tenantId } });
  await prisma.deliveryNote.deleteMany({ where: { tenantId } });
  await prisma.codSettlement.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  buyerId = (
    await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Nomsa Dube", phone: "0721112222" },
    })
  ).id;
});

describe("the bag", () => {
  it("opens with a float", async () => {
    const bag = await openRiderBag({ tenantId, riderMembershipId: riderId, openingFloatCents: 20000 });
    expect(bag.openingFloatCents).toBe(20000);
    expect(bag.closedAt).toBeNull();
  });

  it("refuses a second open bag for the same rider", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    await expect(openRiderBag({ tenantId, riderMembershipId: riderId })).rejects.toThrow(
      /already has a bag open/i
    );
  });

  it("refuses somebody who is not on this team", async () => {
    await expect(openRiderBag({ tenantId, riderMembershipId: "nope" })).rejects.toThrow(
      /not on this team/i
    );
  });

  it("will not take a parcel without a bag open", async () => {
    const id = await note(buyerId);
    await expect(
      assignToRider({ tenantId, deliveryNoteId: id, riderMembershipId: riderId })
    ).rejects.toThrow(/no bag open/i);
  });
});

describe("attempts", () => {
  let noteId: string;

  beforeEach(async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId, openingFloatCents: 10000 });
    noteId = await note(buyerId, 15000);
    await assignToRider({ tenantId, deliveryNoteId: noteId, riderMembershipId: riderId });
  });

  it("records a delivery paid in full", async () => {
    const result = await recordAttempt({
      tenantId,
      deliveryNoteId: noteId,
      outcome: DeliveryOutcome.DELIVERED,
      collectedCents: 15000,
    });
    expect(result.attemptNumber).toBe(1);
    expect(result.note).toMatch(/paid in full/i);

    const row = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(row.status).toBe("DELIVERED");
    expect(row.codCollectedCents).toBe(15000);
  });

  it("says plainly when a delivery came back short", async () => {
    const result = await recordAttempt({
      tenantId,
      deliveryNoteId: noteId,
      outcome: DeliveryOutcome.DELIVERED,
      collectedCents: 10000,
    });
    expect(result.note).toMatch(/short: 50\.00/);
  });

  it("refuses money collected on a delivery that did not happen", async () => {
    await expect(
      recordAttempt({
        tenantId,
        deliveryNoteId: noteId,
        outcome: DeliveryOutcome.REFUSED,
        collectedCents: 15000,
      })
    ).rejects.toThrow(/did not happen/i);
  });

  it("counts a failed try and leaves the parcel open for another", async () => {
    await recordAttempt({ tenantId, deliveryNoteId: noteId, outcome: DeliveryOutcome.NOT_HOME });
    const row = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(row.attemptCount).toBe(1);
    expect(row.status).toBe("SENT");
    expect(row.deliveredAt).toBeNull();
  });

  it("counts every try, including the ones that failed", async () => {
    await recordAttempt({ tenantId, deliveryNoteId: noteId, outcome: DeliveryOutcome.NOT_HOME });
    await recordAttempt({ tenantId, deliveryNoteId: noteId, outcome: DeliveryOutcome.NOT_HOME });
    const third = await recordAttempt({
      tenantId,
      deliveryNoteId: noteId,
      outcome: DeliveryOutcome.DELIVERED,
      collectedCents: 15000,
    });
    expect(third.attemptNumber).toBe(3);
    expect(await prisma.deliveryAttempt.count({ where: { deliveryNoteId: noteId } })).toBe(3);
  });
});

describe("counting the bag back in", () => {
  it("holds a rider to what they took, not to what was refused", async () => {
    const bag = await openRiderBag({ tenantId, riderMembershipId: riderId, openingFloatCents: 10000 });

    const paid = await note(buyerId, 15000);
    const refused = await note(buyerId, 20000);
    await assignToRider({ tenantId, deliveryNoteId: paid, riderMembershipId: riderId });
    await assignToRider({ tenantId, deliveryNoteId: refused, riderMembershipId: riderId });

    await recordAttempt({ tenantId, deliveryNoteId: paid, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });
    await recordAttempt({ tenantId, deliveryNoteId: refused, outcome: DeliveryOutcome.REFUSED });

    // Float 100 + collected 150 = 250 expected, never 350.
    const close = await closeRiderBag({
      tenantId,
      settlementId: bag.id,
      countedCents: 25000,
      closedById: riderId,
    });
    expect(close.expectedCents).toBe(25000);
    expect(close.varianceCents).toBe(0);
    expect(close.note).toMatch(/to the cent/i);
  });

  it("surfaces a short bag rather than absorbing it", async () => {
    const bag = await openRiderBag({ tenantId, riderMembershipId: riderId, openingFloatCents: 10000 });
    const id = await note(buyerId, 15000);
    await assignToRider({ tenantId, deliveryNoteId: id, riderMembershipId: riderId });
    await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });

    const close = await closeRiderBag({ tenantId, settlementId: bag.id, countedCents: 22000, closedById: riderId });
    expect(close.varianceCents).toBe(-3000);
    expect(close.note).toMatch(/short by 30\.00/i);
  });

  it("refuses to close a bag twice", async () => {
    const bag = await openRiderBag({ tenantId, riderMembershipId: riderId });
    await closeRiderBag({ tenantId, settlementId: bag.id, countedCents: 0, closedById: riderId });
    await expect(
      closeRiderBag({ tenantId, settlementId: bag.id, countedCents: 0, closedById: riderId })
    ).rejects.toThrow(/already been closed/i);
  });
});

describe("who is holding what", () => {
  it("shows the money on the road right now", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId, openingFloatCents: 10000 });
    const id = await note(buyerId, 15000);
    await assignToRider({ tenantId, deliveryNoteId: id, riderMembershipId: riderId });
    await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });

    const rows = await ridersHolding(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].riderName).toBe("Bongani Zulu");
    expect(rows[0].holdingCents).toBe(25000);
    expect(rows[0].parcelsDelivered).toBe(1);
  });

  it("drops a rider once the bag is closed", async () => {
    const bag = await openRiderBag({ tenantId, riderMembershipId: riderId });
    await closeRiderBag({ tenantId, settlementId: bag.id, countedCents: 0, closedById: riderId });
    expect(await ridersHolding(tenantId)).toHaveLength(0);
  });
});

describe("who actually takes what they order", () => {
  it("says nothing at all until there is enough history", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    for (let i = 0; i < MIN_DELIVERIES_TO_SCORE - 1; i++) {
      const id = await note(buyerId);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.REFUSED });
    }
    expect(await buyerReliability(tenantId)).toHaveLength(0);
  });

  it("scores a buyer who refuses half of what they order", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    for (let i = 0; i < 2; i++) {
      const id = await note(buyerId);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });
    }
    for (let i = 0; i < 2; i++) {
      const id = await note(buyerId);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.REFUSED });
    }

    const rows = await buyerReliability(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].successPercent).toBe(50);
    expect(rows[0].refused).toBe(2);
    expect(rows[0].delivered).toBe(2);
  });

  it("counts tries per parcel, so a buyer needing three trips shows up", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    for (let i = 0; i < 4; i++) {
      const id = await note(buyerId);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.NOT_HOME });
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });
    }
    const rows = await buyerReliability(tenantId);
    expect(rows[0].attemptsPerParcel).toBe(2);
    expect(rows[0].notHome).toBe(4);
  });

  it("puts the worst buyer first", async () => {
    const good = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Reliable Buyer" },
    });
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    for (let i = 0; i < 4; i++) {
      const id = await note(good.id);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });
    }
    for (let i = 0; i < 4; i++) {
      const id = await note(buyerId);
      await recordAttempt({ tenantId, deliveryNoteId: id, outcome: DeliveryOutcome.REFUSED });
    }

    const rows = await buyerReliability(tenantId);
    expect(rows[0].name).toBe("Nomsa Dube");
    expect(rows[0].successPercent).toBe(0);
    expect(rows[1].successPercent).toBe(100);
  });
});

describe("the depot screen", () => {
  it("counts the redeliveries nobody counts", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    const once = await note(buyerId);
    await recordAttempt({ tenantId, deliveryNoteId: once, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });

    const twice = await note(buyerId);
    await recordAttempt({ tenantId, deliveryNoteId: twice, outcome: DeliveryOutcome.NOT_HOME });
    await recordAttempt({ tenantId, deliveryNoteId: twice, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });

    const picture = await codPicture(tenantId);
    expect(picture.redeliveries).toBe(1);
    expect(picture.deliveredLast30).toBe(2);
    expect(picture.summary).toMatch(/more than one trip/i);
  });

  it("reports the rejection rate", async () => {
    await openRiderBag({ tenantId, riderMembershipId: riderId });
    const a = await note(buyerId);
    await recordAttempt({ tenantId, deliveryNoteId: a, outcome: DeliveryOutcome.DELIVERED, collectedCents: 15000 });
    const b = await note(buyerId);
    await recordAttempt({ tenantId, deliveryNoteId: b, outcome: DeliveryOutcome.REFUSED });

    const picture = await codPicture(tenantId);
    expect(picture.rejectionPercent).toBe(50);
  });

  it("says so plainly when nothing has been attempted", async () => {
    const picture = await codPicture(tenantId);
    expect(picture.summary).toMatch(/no deliveries attempted/i);
  });
});
