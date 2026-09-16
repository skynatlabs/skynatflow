// Businesses that already trade with each other.
//
// Every workspace here holds a list of the customers and suppliers it deals
// with. Across enough workspaces those lists overlap, and the overlap is the
// one thing a competitor cannot copy by building the same features: a
// wholesaler and the forty retailers who buy from it, already connected, so
// an order is a click rather than a WhatsApp message and a retyped invoice.
//
// The reason this is built carefully rather than quickly is that it is also
// the easiest thing here to turn into a privacy disaster. Matching two
// workspaces means saying "the business you know as Naledi Trading is also on
// this platform", which is a fact about a third party that neither workspace
// gave anybody permission to share.
//
// So, three rules:
//
//   A WORKSPACE IS INVISIBLE UNTIL IT ASKS NOT TO BE. Listing is opt-in, off
//   by default, and what it exposes is only what a business already puts on
//   its own invoices — trading name, trade, town.
//
//   A MATCH IS SHOWN ONLY TO SOMEBODY WHO ALREADY HAS THE DETAILS. The
//   suggestion "your supplier is here too" goes to a workspace that already
//   holds that supplier's VAT number. It reveals nothing they did not type in
//   themselves.
//
//   NOTHING ABOUT TRADE CROSSES THE LINE. A connection carries orders both
//   parties agreed to. It never carries prices, volumes or customer lists to
//   the other side.

import { prisma } from "@/lib/db";

export interface Listing {
  tenantId: string;
  name: string;
  trade: string;
  town: string | null;
  /** Whether this workspace is already connected to the one asking. */
  connected: boolean;
}

export async function setListed(tenantId: string, listed: boolean) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { listedInGraph: listed } });
}

/** Only what a business already prints on its own invoices. */
function listingFrom(tenant: { id: string; name: string; niche: string; businessAddress: string | null }, connected: boolean): Listing {
  const town = tenant.businessAddress?.split(",").map((part) => part.trim()).filter(Boolean).slice(-2, -1)[0] ?? null;
  return { tenantId: tenant.id, name: tenant.name, trade: tenant.niche, town, connected };
}

export interface Suggestion {
  listing: Listing;
  /** Which of this workspace's own records matched, and on what. */
  because: string;
  /** Whether they are a customer, a supplier, or both. */
  relationship: "customer" | "supplier" | "both";
}

/**
 * Businesses this workspace already deals with that are also here.
 *
 * Matched on the registration or VAT number the workspace itself typed in —
 * never on a name, because two businesses called "Highway Motors" are not the
 * same business and connecting them would put one's orders into the other's
 * system.
 */
export async function findPartners(tenantId: string): Promise<{ suggestions: Suggestion[]; note: string }> {
  const parties = await prisma.party.findMany({
    where: { tenantId, OR: [{ vatNumber: { not: null } }, { registrationNumber: { not: null } }] },
    select: { name: true, companyName: true, role: true, vatNumber: true, registrationNumber: true },
    take: 500,
  });

  if (parties.length === 0) {
    return {
      suggestions: [],
      note: "Nobody in this workspace has a VAT or registration number recorded, so there is nothing to match on. A name is not enough — two businesses called Highway Motors are not the same business.",
    };
  }

  const vatNumbers = parties.map((party) => party.vatNumber).filter((value): value is string => !!value);
  const registrations = parties.map((party) => party.registrationNumber).filter((value): value is string => !!value);

  const candidates = await prisma.tenant.findMany({
    where: {
      id: { not: tenantId },
      listedInGraph: true,
      OR: [
        ...(vatNumbers.length > 0 ? [{ vatNumber: { in: vatNumbers } }] : []),
        ...(registrations.length > 0 ? [{ registrationNumber: { in: registrations } }] : []),
      ],
    },
    select: { id: true, name: true, niche: true, businessAddress: true, vatNumber: true, registrationNumber: true },
    take: 100,
  });

  const existing = await prisma.wholesaleConnection.findMany({
    where: { OR: [{ supplierTenantId: tenantId }, { buyerTenantId: tenantId }] },
    select: { supplierTenantId: true, buyerTenantId: true },
  });
  const connectedIds = new Set(existing.flatMap((row) => [row.supplierTenantId, row.buyerTenantId]));

  const suggestions: Suggestion[] = [];
  for (const candidate of candidates) {
    const matches = parties.filter(
      (party) =>
        (candidate.vatNumber && party.vatNumber === candidate.vatNumber) ||
        (candidate.registrationNumber && party.registrationNumber === candidate.registrationNumber),
    );
    if (matches.length === 0) continue;

    const roles = new Set(matches.map((match) => match.role));
    const relationship: Suggestion["relationship"] =
      roles.has("CUSTOMER") && roles.has("SUPPLIER") ? "both" : roles.has("SUPPLIER") ? "supplier" : "customer";

    const their = matches[0];
    suggestions.push({
      listing: listingFrom(candidate, connectedIds.has(candidate.id)),
      because: `You have them as ${their.companyName ?? their.name}, with the same ${candidate.vatNumber && their.vatNumber === candidate.vatNumber ? "VAT number" : "registration number"}.`,
      relationship,
    });
  }

  return {
    suggestions,
    note:
      suggestions.length === 0
        ? "None of the businesses you deal with are listed here yet. That will change as more of them arrive."
        : "These matched on a number you already have on file, so nothing here is a detail you did not already hold.",
  };
}

/**
 * What the graph is worth to this workspace.
 *
 * Stated as saved effort rather than as a network diagram, because "eleven
 * orders arrived without anybody retyping them" is a reason to keep using
 * something and a count of nodes is not.
 */
export async function graphValue(tenantId: string, since: Date) {
  const connections = await prisma.wholesaleConnection.findMany({
    where: { status: "ACCEPTED", OR: [{ supplierTenantId: tenantId }, { buyerTenantId: tenantId }] },
    select: { id: true, supplierTenantId: true, buyerTenantId: true, createdAt: true },
  });

  const asSupplier = connections.filter((row) => row.supplierTenantId === tenantId).length;
  const asBuyer = connections.filter((row) => row.buyerTenantId === tenantId).length;

  // Orders that arrived through a connection rather than being typed in. The
  // marker is the same one placeConnectedOrder writes.
  const ordersIn = await prisma.transaction.count({
    where: { tenantId, type: "QUOTE", createdAt: { gte: since }, subject: { contains: "connected order", mode: "insensitive" } },
  });

  // Ten minutes per order: finding the message, retyping the lines, checking
  // the price, sending it back. An estimate, and said to be one.
  const minutesSaved = ordersIn * 10;

  return {
    connections: connections.length,
    asSupplier,
    asBuyer,
    ordersIn,
    minutesSaved,
    sentence:
      connections.length === 0
        ? "No trading connections yet. They are worth setting up with whoever you order from most — an order becomes a click rather than a message and a retyped invoice."
        : `${connections.length} trading ${connections.length === 1 ? "connection" : "connections"}: ${asSupplier} where you supply, ${asBuyer} where you buy.${ordersIn > 0 ? ` ${ordersIn} ${ordersIn === 1 ? "order has" : "orders have"} arrived through them without anybody retyping anything — roughly ${Math.round(minutesSaved / 60)} hours.` : ""}`,
    caveat: "Ten minutes an order is an estimate of what retyping one costs, not a measurement.",
  };
}

/**
 * What the platform can see across all of it.
 *
 * For the operator, not for a business. Counts only — there is no view here
 * of who trades with whom, because that would be exactly the file nobody
 * should be able to ask for.
 */
export async function networkShape() {
  const [listed, connections, accepted] = await Promise.all([
    prisma.tenant.count({ where: { listedInGraph: true } }),
    prisma.wholesaleConnection.count(),
    prisma.wholesaleConnection.count({ where: { status: "ACCEPTED" } }),
  ]);

  return {
    listed,
    connections,
    accepted,
    acceptedShare: connections > 0 ? Math.round((accepted / connections) * 100) : 0,
    note: "Counts only. There is no view of who trades with whom here, because that is exactly the file nobody should be able to ask for.",
  };
}
