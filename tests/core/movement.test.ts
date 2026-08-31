// PA job: booking a future site visit/consultation — see
// src/lib/core/movement.ts scheduleAppointment.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { scheduleAppointment } from "../../src/lib/core/movement";

let tenantId: string;
let partyId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Scheduling Co", niche: "SERVICES" } });
  tenantId = tenant.id;
  const party = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Site Visit Customer" } });
  partyId = party.id;
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { tenantId } });
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("scheduleAppointment", () => {
  it("books a future site visit", async () => {
    const scheduledAt = new Date(Date.now() + 2 * 86400000);
    const event = await scheduleAppointment({ tenantId, partyId, type: "SITE_VISIT", scheduledAt });
    expect(event.type).toBe("SITE_VISIT");
    expect(event.scheduledAt?.getTime()).toBe(scheduledAt.getTime());
  });

  it("rejects booking an appointment in the past", async () => {
    const scheduledAt = new Date(Date.now() - 86400000);
    await expect(scheduleAppointment({ tenantId, partyId, type: "SITE_VISIT", scheduledAt })).rejects.toThrow();
  });
});
