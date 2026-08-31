// PA job: "the customer wants their [detail] changed" — a partial
// update that only touches fields actually mentioned, never overwrites
// the rest. See src/lib/core/parties.ts applyPartyDetailChange.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { applyPartyDetailChange } from "../../src/lib/core/parties";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Test Party Edit Co", niche: "SERVICES" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.party.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("applyPartyDetailChange", () => {
  it("updates only the field mentioned, leaving everything else untouched", async () => {
    const party = await prisma.party.create({
      data: { tenantId, role: PartyRole.CUSTOMER, name: "Acme Corp", vatNumber: "OLD123", city: "Cape Town" },
    });

    await applyPartyDetailChange(tenantId, party.id, { vatNumber: "NEW456" });

    const updated = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
    expect(updated.vatNumber).toBe("NEW456");
    expect(updated.name).toBe("Acme Corp");
    expect(updated.city).toBe("Cape Town");
  });

  it("applies multiple mentioned fields at once", async () => {
    const party = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "Multi Field Customer" } });

    await applyPartyDetailChange(tenantId, party.id, { addressLine: "12 Oak Street", city: "Johannesburg", postalCode: "2000" });

    const updated = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
    expect(updated.addressLine).toBe("12 Oak Street");
    expect(updated.city).toBe("Johannesburg");
    expect(updated.postalCode).toBe("2000");
  });

  it("throws when no fields to change were actually given", async () => {
    const party = await prisma.party.create({ data: { tenantId, role: PartyRole.CUSTOMER, name: "No Change Customer" } });
    await expect(applyPartyDetailChange(tenantId, party.id, {})).rejects.toThrow();
  });

  it("refuses to update a party belonging to a different tenant", async () => {
    const otherTenant = await prisma.tenant.create({ data: { name: "Other Tenant Co", niche: "SERVICES" } });
    const foreignParty = await prisma.party.create({ data: { tenantId: otherTenant.id, role: PartyRole.CUSTOMER, name: "Foreign Customer" } });

    await expect(applyPartyDetailChange(tenantId, foreignParty.id, { city: "Nowhere" })).rejects.toThrow();

    await prisma.party.deleteMany({ where: { tenantId: otherTenant.id } });
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});
