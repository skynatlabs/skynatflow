// The Business Graph API — party (people) functions.
// One address book for customers, suppliers, and staff — role is a field,
// not a separate table, per the strategic report's core-object design.

import { PartyRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function createParty(params: {
  tenantId: string;
  role: PartyRole;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  return prisma.party.create({ data: params });
}

export async function findPartyByPhone(tenantId: string, phone: string) {
  return prisma.party.findFirst({ where: { tenantId, phone } });
}

// "Customer" in most niches, "Patient" in the medical niche — same query,
// the caller passes whichever role that tenant's niche uses for its
// end-customer-equivalent record. Both roles are included by default so
// this works correctly regardless of niche without the caller needing to
// know the mapping.
export async function listCustomers(
  tenantId: string,
  roles: PartyRole[] = [PartyRole.CUSTOMER, PartyRole.PATIENT]
) {
  return prisma.party.findMany({
    where: { tenantId, role: { in: roles } },
    orderBy: { createdAt: "desc" },
  });
}

// Full picture behind one customer record: every quote, invoice, payment,
// and delivery/visit against them, in one call — this is what makes the
// "unified customer record" claim in the strategic report real, not marketing.
export async function customerHistory(tenantId: string, partyId: string) {
  const [party, transactions, events] = await Promise.all([
    prisma.party.findUniqueOrThrow({ where: { id: partyId } }),
    prisma.transaction.findMany({
      where: { tenantId, partyId },
      orderBy: { createdAt: "desc" },
      include: { itemLines: { include: { item: true } } },
    }),
    prisma.event.findMany({
      where: { tenantId, partyId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { party, transactions, events };
}
