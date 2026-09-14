// PA job: "the customer wants their [detail] changed" — a partial
// update that only touches fields actually mentioned, never overwrites
// the rest. See src/lib/core/parties.ts applyPartyDetailChange.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PartyRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { applyPartyDetailChange, listCustomersPaginated } from "../../src/lib/core/parties";

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

// The dashboard's global search box submits ?q= to the customers page,
// which passes it through to this filter. It used to be dropped on the
// floor — the box searched nothing — so these pin the behaviour down.
describe("listCustomersPaginated — search filter", () => {
  let searchTenant: string;

  beforeAll(async () => {
    const t = await prisma.tenant.create({ data: { name: "Search Co", niche: "SERVICES" } });
    searchTenant = t.id;
    await prisma.party.createMany({
      data: [
        { tenantId: searchTenant, role: PartyRole.CUSTOMER, name: "Jane Homeowner", phone: "+27821234567" },
        { tenantId: searchTenant, role: PartyRole.CUSTOMER, name: "Bob Builder", email: "bob@example.com" },
        { tenantId: searchTenant, role: PartyRole.CUSTOMER, name: "Carol Client" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.party.deleteMany({ where: { tenantId: searchTenant } });
    await prisma.tenant.delete({ where: { id: searchTenant } });
  });

  it("returns everyone when no query is given", async () => {
    const { items, total } = await listCustomersPaginated(searchTenant, 1);
    expect(total).toBe(3);
    expect(items).toHaveLength(3);
  });

  it("matches on name, case-insensitively", async () => {
    const { items, total } = await listCustomersPaginated(searchTenant, 1, undefined, "jane");
    expect(total).toBe(1);
    expect(items[0].name).toBe("Jane Homeowner");
  });

  it("matches on email and on phone", async () => {
    const byEmail = await listCustomersPaginated(searchTenant, 1, undefined, "bob@example");
    expect(byEmail.total).toBe(1);
    const byPhone = await listCustomersPaginated(searchTenant, 1, undefined, "27821234567");
    expect(byPhone.total).toBe(1);
    expect(byPhone.items[0].name).toBe("Jane Homeowner");
  });

  it("returns nothing for a query that matches nobody", async () => {
    const { items, total } = await listCustomersPaginated(searchTenant, 1, undefined, "zzzznope");
    expect(total).toBe(0);
    expect(items).toHaveLength(0);
  });

  it("treats a whitespace-only query as no filter at all", async () => {
    const { total } = await listCustomersPaginated(searchTenant, 1, undefined, "   ");
    expect(total).toBe(3);
  });

  it("never reaches across tenants, even on a matching name", async () => {
    const other = await prisma.tenant.create({ data: { name: "Other Search Co", niche: "RETAIL" } });
    await prisma.party.create({
      data: { tenantId: other.id, role: PartyRole.CUSTOMER, name: "Jane Homeowner" },
    });

    const { total } = await listCustomersPaginated(searchTenant, 1, undefined, "jane");
    expect(total).toBe(1); // only this tenant's Jane, not both

    await prisma.party.deleteMany({ where: { tenantId: other.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
