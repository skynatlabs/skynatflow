// Property sales, leasing & management. A Property is the asset, a Lease
// is a specific tenancy on it — kept as its own domain rather than forced
// through the commercial Transaction ledger, since a lease has a
// start/end/deposit lifecycle a one-off sale doesn't.

import { prisma } from "@/lib/db";
import { PropertyType, LeaseStatus } from "@prisma/client";

export async function createProperty(params: {
  tenantId: string;
  address: string;
  propertyType: PropertyType;
  ownerPartyId?: string;
  listingPriceCents?: number;
  rentalRateCents?: number;
}) {
  return prisma.property.create({ data: params });
}

// Self-limiting by nature (a property leaves AVAILABLE the moment it's
// leased/sold), so this stays a plain findMany rather than paginated — it
// feeds the "pick a property to lease" dropdown, which needs the full set.
export async function listAvailableProperties(tenantId: string) {
  return prisma.property.findMany({
    where: { tenantId, status: "AVAILABLE" },
    orderBy: { createdAt: "desc" },
  });
}

const PROPERTIES_PAGE_SIZE = 25;

export async function listProperties(tenantId: string, page = 1) {
  const where = { tenantId };
  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PROPERTIES_PAGE_SIZE,
      take: PROPERTIES_PAGE_SIZE,
    }),
    prisma.property.count({ where }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / PROPERTIES_PAGE_SIZE)) };
}

export async function setPropertyStatus(
  tenantId: string,
  propertyId: string,
  status: "AVAILABLE" | "LEASED" | "SOLD" | "MAINTENANCE"
) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.tenantId !== tenantId) throw new Error("Property not found.");
  return prisma.property.update({ where: { id: propertyId }, data: { status } });
}

export async function createLease(params: {
  tenantId: string;
  propertyId: string;
  renterPartyId: string;
  startDate: Date;
  endDate?: Date;
  monthlyRentCents: number;
  depositCents?: number;
  documentDataUrl?: string;
}) {
  const lease = await prisma.lease.create({ data: params });
  await prisma.property.update({ where: { id: params.propertyId }, data: { status: "LEASED" } });
  return lease;
}

export async function endLease(tenantId: string, leaseId: string, status: LeaseStatus = "ENDED") {
  const existing = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!existing || existing.tenantId !== tenantId) throw new Error("Lease not found.");

  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status, endDate: new Date() },
  });
  await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "AVAILABLE" } });
  return lease;
}

const LEASES_PAGE_SIZE = 25;

export async function listLeases(tenantId: string, page = 1) {
  const where = { tenantId };
  const [items, total] = await Promise.all([
    prisma.lease.findMany({
      where,
      include: { property: true, renterParty: true },
      orderBy: { startDate: "desc" },
      skip: (page - 1) * LEASES_PAGE_SIZE,
      take: LEASES_PAGE_SIZE,
    }),
    prisma.lease.count({ where }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / LEASES_PAGE_SIZE)) };
}

// Leases coming up for renewal/expiry within the window — the property
// equivalent of the overdue-invoice/expiry-risk pattern used elsewhere:
// surface it before it lapses, not after.
export async function getExpiringLeases(tenantId: string, withinDays = 30) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86400000);
  return prisma.lease.findMany({
    where: { tenantId, status: "ACTIVE", endDate: { not: null, lte: cutoff } },
    include: { property: true, renterParty: true },
    orderBy: { endDate: "asc" },
  });
}
