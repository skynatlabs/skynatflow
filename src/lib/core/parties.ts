// The Business Graph API — party (people) functions.
// One address book for customers, suppliers, and staff — role is a field,
// not a separate table, per the strategic report's core-object design.

import { randomBytes } from "crypto";
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

// One shared "Walk-in" record per tenant for cash sales where the customer
// doesn't want to give their details — reused across sales rather than
// creating a fresh nameless Party every time, per the cash-sale
// quick-capture feature (no upfront customer record required).
export async function getOrCreateWalkInParty(tenantId: string, role: PartyRole) {
  const existing = await prisma.party.findFirst({
    where: { tenantId, name: "Walk-in customer" },
  });
  if (existing) return existing;
  return prisma.party.create({ data: { tenantId, role, name: "Walk-in customer" } });
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

// Customer portal — Soler's proven token-login pattern (no password, just
// a link), generalized onto the shared Party model. Lazily generated the
// first time a link is requested, then stable for that party going forward.
export async function getOrCreatePortalToken(partyId: string): Promise<string> {
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  if (party.portalToken) return party.portalToken;

  const token = randomBytes(24).toString("base64url");
  await prisma.party.update({ where: { id: partyId }, data: { portalToken: token } });
  return token;
}

export async function findPartyByPortalToken(token: string) {
  return prisma.party.findUnique({ where: { portalToken: token } });
}
