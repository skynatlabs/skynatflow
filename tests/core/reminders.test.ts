// PA job: marking a missed appointment as a no-show and nudging for a
// rebooking — see src/lib/core/reminders.ts markNoShowAndRebook.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole, EventType } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { markNoShowAndRebook } from "../../src/lib/core/reminders";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test No-Show Clinic", niche: "MEDICAL" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("markNoShowAndRebook", () => {
  it("marks the event as a no-show and reports success when the customer has a phone on file", async () => {
    const patient = await prisma.party.create({ data: { tenantId, role: PartyRole.PATIENT, name: "Missed Appointment Patient", phone: "+27821234567" } });
    const event = await prisma.event.create({
      data: { tenantId, partyId: patient.id, type: EventType.CONSULTATION, scheduledAt: new Date(Date.now() - 3600000) },
    });

    const result = await markNoShowAndRebook(event.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.noShow).toBe(true);
  });

  it("still marks the no-show but reports it can't nudge when there's no phone on file", async () => {
    const patient = await prisma.party.create({ data: { tenantId, role: PartyRole.PATIENT, name: "No Phone Patient" } });
    const event = await prisma.event.create({
      data: { tenantId, partyId: patient.id, type: EventType.CONSULTATION, scheduledAt: new Date(Date.now() - 3600000) },
    });

    const result = await markNoShowAndRebook(event.id);
    expect(result.ok).toBe(false);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.noShow).toBe(true);
  });

  it("returns a clear failure for an unknown event id instead of throwing", async () => {
    const result = await markNoShowAndRebook("nonexistent-event-id");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
