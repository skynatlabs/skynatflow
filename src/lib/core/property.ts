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

export async function listProperties(tenantId: string) {
  return prisma.property.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
}

export async function setPropertyStatus(propertyId: string, status: "AVAILABLE" | "LEASED" | "SOLD" | "MAINTENANCE") {
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

export async function endLease(leaseId: string, status: LeaseStatus = "ENDED") {
  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status, endDate: new Date() },
  });
  await prisma.property.update({ where: { id: lease.propertyId }, data: { status: "AVAILABLE" } });
  return lease;
}

export async function listLeases(tenantId: string) {
  return prisma.lease.findMany({
    where: { tenantId },
    include: { property: true, renterParty: true },
    orderBy: { startDate: "desc" },
  });
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
