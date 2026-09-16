// Getting the thing to the customer.
//
// Every courier in South Africa has an API and every one of them issues
// credentials per account, so none of them can be live on a deployment that
// has not signed up as that business. That is a real limit and this says so.
//
// What does not need anybody's permission, and is most of the daily work:
// knowing which courier suits a parcel, what it will cost, what to write on
// the waybill, and a collection sheet the driver signs. A business that can
// print a manifest and record a waybill number has the part that matters —
// the tracking link is a convenience on top.
//
// The one real trap this avoids: a parcel's price is charged on volumetric
// weight, not actual weight, and a business that quotes on the scale number
// loses money on everything bulky. That calculation is here and correct.

import { prisma } from "@/lib/db";

export type Courier = "courier-guy" | "aramex" | "postnet" | "pargo" | "dawn-wing" | "internal";

export interface CourierDef {
  key: Courier;
  label: string;
  /** What this one is actually good for. */
  suits: string;
  /** Cubic conversion: volumetric kg = (L × W × H in cm) ÷ this. */
  volumetricDivisor: number;
  /** Whether they collect, or the parcel is dropped off. */
  collects: boolean;
  liveBooking: string;
}

export const COURIERS: CourierDef[] = [
  {
    key: "courier-guy",
    label: "The Courier Guy",
    suits: "Most things, most places. The default for a parcel under 30kg going door to door.",
    volumetricDivisor: 5000,
    collects: true,
    liveBooking: "Live booking needs this business's own Courier Guy API credentials. Not connected.",
  },
  {
    key: "aramex",
    label: "Aramex",
    suits: "Documents and small parcels, and anything crossing a border.",
    volumetricDivisor: 5000,
    collects: true,
    liveBooking: "Needs an Aramex account number and key. Not connected.",
  },
  {
    key: "postnet",
    label: "PostNet to PostNet",
    suits: "Cheap, when the customer is happy to collect from a store. Usually the lowest price for a small parcel.",
    volumetricDivisor: 4000,
    collects: false,
    liveBooking: "No public API. Booked over the counter.",
  },
  {
    key: "pargo",
    label: "Pargo pickup point",
    suits: "Customers with no safe delivery address — a flat, a site, somebody who is out all day.",
    volumetricDivisor: 5000,
    collects: true,
    liveBooking: "Needs a Pargo merchant account. Not connected.",
  },
  {
    key: "dawn-wing",
    label: "Dawn Wing",
    suits: "Heavier freight and pallets, where a parcel courier will not take it.",
    volumetricDivisor: 4000,
    collects: true,
    liveBooking: "Needs an account with DPD Laser. Not connected.",
  },
  {
    key: "internal",
    label: "Our own vehicle",
    suits: "Local, or anything that has to be there today. Already tracked as a trip.",
    volumetricDivisor: 5000,
    collects: true,
    liveBooking: "Built — this is a trip, not a courier booking.",
  },
];

export const COURIER_BY_KEY: Record<string, CourierDef> = Object.fromEntries(COURIERS.map((c) => [c.key, c]));

/**
 * What the parcel will actually be charged on.
 *
 * Couriers bill on whichever is greater: what it weighs, or what it takes up.
 * A business quoting on the bathroom-scale number loses money on everything
 * light and bulky, which for most sellers is most of what they ship.
 */
export function chargeableWeight(params: {
  actualKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  courier: Courier;
}): { chargeableKg: number; volumetricKg: number; charged: "actual" | "volume"; note: string } {
  const divisor = COURIER_BY_KEY[params.courier]?.volumetricDivisor ?? 5000;
  const volumetric = Math.round(((params.lengthCm * params.widthCm * params.heightCm) / divisor) * 100) / 100;
  const chargeable = Math.max(params.actualKg, volumetric);

  return {
    chargeableKg: Math.ceil(chargeable * 2) / 2, // couriers round up to the half kilo
    volumetricKg: volumetric,
    charged: volumetric > params.actualKg ? "volume" : "actual",
    note:
      volumetric > params.actualKg
        ? `This is charged on its size, not its weight — ${volumetric}kg volumetric against ${params.actualKg}kg on the scale. Quote on ${Math.ceil(chargeable * 2) / 2}kg.`
        : `Charged on its actual weight of ${params.actualKg}kg; the box is small enough not to matter.`,
  };
}

/** Which courier suits this parcel, with the reasoning stated. */
export function suggestCourier(params: { chargeableKg: number; sameDay?: boolean; localKm?: number; customerCanCollect?: boolean }): {
  courier: Courier;
  label: string;
  why: string;
  alternatives: Array<{ courier: Courier; label: string; why: string }>;
} {
  const options: Array<{ courier: Courier; label: string; why: string; score: number }> = [];

  if (params.sameDay || (params.localKm !== undefined && params.localKm <= 40)) {
    options.push({ courier: "internal", label: "Our own vehicle", why: "Close enough to do it ourselves, and it goes today.", score: 100 });
  }
  if (params.chargeableKg > 30) {
    options.push({ courier: "dawn-wing", label: "Dawn Wing", why: "Over 30kg, which most parcel couriers will not take.", score: 90 });
  }
  if (params.customerCanCollect) {
    options.push({ courier: "postnet", label: "PostNet to PostNet", why: "Cheapest, and the customer said they can collect.", score: 80 });
  }
  options.push({ courier: "courier-guy", label: "The Courier Guy", why: "Door to door almost anywhere, and reliable.", score: 70 });
  options.push({ courier: "pargo", label: "Pargo pickup point", why: "For a customer with nowhere safe to receive it.", score: 40 });

  options.sort((a, b) => b.score - a.score);
  const [best, ...rest] = options;

  return {
    courier: best.courier,
    label: best.label,
    why: best.why,
    alternatives: rest.slice(0, 2).map(({ courier, label, why }) => ({ courier, label, why })),
  };
}

export interface ManifestRow {
  waybill: string | null;
  customer: string;
  address: string;
  contact: string | null;
  pieces: number;
  reference: string;
}

/**
 * The sheet the driver signs.
 *
 * The one piece of paper that settles "we never received it": a list, a
 * count, a signature and a date. Printed from what is already in the system,
 * so nobody retypes addresses at five to five.
 */
export async function collectionManifest(params: { tenantId: string; on: Date }): Promise<{
  rows: ManifestRow[];
  pieces: number;
  businessName: string;
  note: string;
}> {
  const start = new Date(Date.UTC(params.on.getUTCFullYear(), params.on.getUTCMonth(), params.on.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);

  const [tenant, notes] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { name: true } }),
    prisma.deliveryNote.findMany({
      where: { tenantId: params.tenantId, status: { not: "DELIVERED" }, createdAt: { gte: start, lt: end } },
      include: { party: { select: { name: true, companyName: true, phone: true, addressLine: true } }, lines: { select: { quantity: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  const rows: ManifestRow[] = notes.map((note) => ({
    waybill: note.reference,
    customer: note.party?.companyName ?? note.party?.name ?? "Collection",
    address: note.deliveryAddress ?? note.party?.addressLine ?? "— no address recorded —",
    contact: note.party?.phone ?? null,
    pieces: Math.max(1, note.lines.reduce((sum, line) => sum + line.quantity, 0)),
    reference: note.number,
  }));

  const missingAddress = rows.filter((row) => row.address.startsWith("—")).length;

  return {
    rows,
    pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
    businessName: tenant.name,
    note:
      missingAddress > 0
        ? `${missingAddress} ${missingAddress === 1 ? "parcel has" : "parcels have"} no delivery address on the note. The driver will not be able to take ${missingAddress === 1 ? "it" : "them"}.`
        : `${rows.length} ${rows.length === 1 ? "parcel" : "parcels"} ready for collection.`,
  };
}

/** Record the number the courier gave back, so a customer asking can be answered. */
export async function recordWaybill(params: { tenantId: string; deliveryNoteId: string; courier: Courier; waybill: string }) {
  const note = await prisma.deliveryNote.findFirst({ where: { id: params.deliveryNoteId, tenantId: params.tenantId } });
  if (!note) throw new Error("That delivery note is not in this workspace.");
  if (!params.waybill.trim()) throw new Error("A waybill number is needed, otherwise there is nothing to track.");

  return prisma.deliveryNote.update({
    where: { id: note.id },
    data: {
      reference: params.waybill.trim(),
      notes: [note.notes, `Sent with ${COURIER_BY_KEY[params.courier]?.label ?? params.courier}.`].filter(Boolean).join("\n"),
    },
  });
}

/** Where a customer goes to look. Public tracking pages need no credentials. */
export function trackingUrl(courier: Courier, waybill: string): string | null {
  const encoded = encodeURIComponent(waybill.trim());
  switch (courier) {
    case "courier-guy":
      return `https://portal.thecourierguy.co.za/track?ref=${encoded}`;
    case "aramex":
      return `https://www.aramex.co.za/tools/track/?l=${encoded}`;
    case "dawn-wing":
      return `https://www.dawnwing.co.za/track/${encoded}`;
    case "pargo":
      return `https://pargo.co.za/track-my-parcel/?tracking=${encoded}`;
    default:
      return null;
  }
}
