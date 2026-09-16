// The Business Graph API — party (people) functions.
// One address book for customers, suppliers, and staff — role is a field,
// not a separate table, per the strategic report's core-object design.

import { randomBytes } from "crypto";
import { PartyRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/agent/events";

export async function createParty(params: {
  tenantId: string;
  role: PartyRole;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  companyName?: string;
  vatNumber?: string;
  addressLine?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}) {
  const party = await prisma.party.create({ data: params });

  // Customers only. A new supplier or a new staff member is housekeeping;
  // a new customer is the start of a relationship the agent should know
  // about when it next looks at who has gone quiet.
  if (params.role === PartyRole.CUSTOMER) {
    await emitEvent({
      tenantId: params.tenantId,
      type: "customer.created",
      subjectType: "Party",
      subjectId: party.id,
      payload: { name: party.name },
    });
  }

  return party;
}

/**
 * Somebody by their phone number, however either was written down.
 *
 * This used to be an exact string match, which meant "083 555 1234" and
 * "+27 83 555 1234" were two different people — so a missed-call webhook, a
 * booking and a WhatsApp reply all silently failed to find somebody who was
 * plainly on file, and quietly made a second customer instead.
 *
 * Both sides are stripped to digits and compared on the last nine, which is
 * the part that survives every country code and leading zero. Nine rather
 * than ten, because a South African number written with its country code and
 * one written without differ in exactly the leading digit.
 */
export async function findPartyByPhone(tenantId: string, phone: string) {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  const tail = digits.slice(-9);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM parties
    WHERE "tenantId" = ${tenantId}
      AND phone IS NOT NULL
      AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${"%" + tail}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return prisma.party.findUnique({ where: { id: rows[0].id } });
}

export interface PartyDetailPatch {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  vatNumber?: string;
  addressLine?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

// PA job: "the customer wants their [detail] changed on the invoice" —
// a partial update, only touching fields actually specified. Deliberately
// separate from the manual edit form's action (which always submits every
// field from a full form and would otherwise null out anything not
// mentioned in a natural-language request).
export async function applyPartyDetailChange(tenantId: string, partyId: string, patch: PartyDetailPatch) {
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  if (party.tenantId !== tenantId) throw new Error("Not found.");

  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null && v !== ""));
  if (Object.keys(data).length === 0) {
    throw new Error("No details to change were given.");
  }

  return prisma.party.update({ where: { id: partyId }, data });
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

const CUSTOMERS_PAGE_SIZE = 25;

export async function listCustomersPaginated(
  tenantId: string,
  page = 1,
  roles: PartyRole[] = [PartyRole.CUSTOMER, PartyRole.PATIENT],
  // Free-text filter used by the dashboard's global search box. Matches
  // name, email or phone so a partial memory of any one of them finds the
  // record. Always ANDed with tenantId — never widens the tenant scope.
  query?: string
) {
  const q = query?.trim();
  const where = {
    tenantId,
    role: { in: roles },
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.party.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * CUSTOMERS_PAGE_SIZE,
      take: CUSTOMERS_PAGE_SIZE,
    }),
    prisma.party.count({ where }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)) };
}

// Full picture behind one customer record: every quote, invoice, payment,
// and delivery/visit against them, in one call — this is what makes the
// "unified customer record" claim in the strategic report real, not marketing.
//
// The party lookup is scoped to tenantId, not just the id from the URL —
// without that, a stale link, a deleted customer, or a party id belonging
// to a different tenant would either throw an unhandled 500 (findUniqueOrThrow
// on a not-found id) or silently leak another tenant's customer record.
// Returns null when the customer doesn't belong to this tenant so the page
// can render a real 404 instead of crashing.
export async function customerHistory(tenantId: string, partyId: string) {
  const [party, transactions, events] = await Promise.all([
    prisma.party.findFirst({ where: { id: partyId, tenantId } }),
    prisma.transaction.findMany({
      where: { tenantId, partyId },
      orderBy: { createdAt: "desc" },
      include: { itemLines: { include: { item: true }, orderBy: { sortOrder: "asc" } } },
    }),
    prisma.event.findMany({
      where: { tenantId, partyId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!party) return null;

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
