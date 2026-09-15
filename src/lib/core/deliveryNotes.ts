// What went out of the door.
//
// A packing slip and a delivery note are one document read by two people:
// whoever loads the van, and whoever signs for it. It is kept apart from the
// invoice because a delivery is not always the whole invoice — part orders,
// back orders and a second trip on Thursday are ordinary, and an invoice that
// pretends otherwise is how a business argues with a customer about what
// actually arrived.
//
// Every note knows what it delivered against, so what is still owed on an
// order is arithmetic rather than memory.

import { DeliveryNoteStatus, PartyRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface DeliveryLineInput {
  itemId?: string | null;
  description: string;
  quantity: number;
  unit?: string | null;
}

export interface CreateDeliveryNoteParams {
  tenantId: string;
  partyId?: string | null;
  /** The invoice or quote being delivered against. */
  transactionId?: string | null;
  lines?: DeliveryLineInput[];
  deliveryAddress?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdById?: string | null;
  tripStopId?: string | null;
}

/** DN-0001, DN-0002 — per workspace, in order, and never reused. */
export async function nextDeliveryNumber(tenantId: string): Promise<string> {
  const last = await prisma.deliveryNote.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.replace(/\D/g, "")) : 0;
  return `DN-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
}

/** What has already gone out against a document, by item and by wording. */
export async function deliveredSoFar(tenantId: string, transactionId: string): Promise<Map<string, number>> {
  const notes = await prisma.deliveryNote.findMany({
    where: { tenantId, transactionId, status: { not: DeliveryNoteStatus.DRAFT } },
    select: { lines: { select: { itemId: true, description: true, quantity: true } } },
  });
  const out = new Map<string, number>();
  for (const note of notes) {
    for (const line of note.lines) {
      const key = line.itemId ?? `text:${line.description.toLowerCase()}`;
      out.set(key, (out.get(key) ?? 0) + line.quantity);
    }
  }
  return out;
}

/**
 * The lines of a document that have not been delivered yet — what a new note
 * starts with, so nobody re-picks a line that already went last week.
 */
export async function outstandingLines(tenantId: string, transactionId: string): Promise<DeliveryLineInput[]> {
  const doc = await prisma.transaction.findFirst({
    where: { id: transactionId, tenantId },
    select: {
      itemLines: {
        orderBy: { sortOrder: "asc" },
        select: { itemId: true, quantity: true, description: true, unit: true, item: { select: { name: true, unit: true } } },
      },
    },
  });
  if (!doc) throw new Error("That document is not in this workspace.");

  const already = await deliveredSoFar(tenantId, transactionId);
  const out: DeliveryLineInput[] = [];
  for (const line of doc.itemLines) {
    const description = line.description ?? line.item.name;
    const key = line.itemId ?? `text:${description.toLowerCase()}`;
    const remaining = line.quantity - (already.get(key) ?? 0);
    if (remaining <= 0) continue;
    out.push({ itemId: line.itemId, description, quantity: remaining, unit: line.unit ?? line.item.unit });
  }
  return out;
}

export async function createDeliveryNote(params: CreateDeliveryNoteParams) {
  const { tenantId } = params;

  let partyId = params.partyId ?? null;
  let lines = params.lines ?? [];

  if (params.transactionId) {
    const doc = await prisma.transaction.findFirst({
      where: { id: params.transactionId, tenantId },
      select: { id: true, partyId: true },
    });
    if (!doc) throw new Error("That document is not in this workspace.");
    partyId ??= doc.partyId;
    if (lines.length === 0) lines = await outstandingLines(tenantId, params.transactionId);
  }

  if (!partyId) throw new Error("A delivery note needs a customer.");
  const party = await prisma.party.findFirst({ where: { id: partyId, tenantId }, select: { id: true, addressLine: true, city: true, postalCode: true } });
  if (!party) throw new Error("That customer is not in this workspace.");

  const clean = lines
    .map((l) => ({ ...l, description: l.description?.trim() ?? "", quantity: Math.round(l.quantity) }))
    .filter((l) => l.description && l.quantity > 0);
  if (clean.length === 0) throw new Error("There is nothing left to deliver on that document.");

  // Items named on the note have to belong here, the same as anywhere else.
  const itemIds = [...new Set(clean.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  if (itemIds.length > 0) {
    const owned = await prisma.item.count({ where: { tenantId, id: { in: itemIds } } });
    if (owned !== itemIds.length) throw new Error("One of those products is not in this workspace.");
  }

  return prisma.deliveryNote.create({
    data: {
      tenantId,
      number: await nextDeliveryNumber(tenantId),
      partyId,
      transactionId: params.transactionId ?? null,
      tripStopId: params.tripStopId ?? null,
      deliveryAddress:
        params.deliveryAddress ?? [party.addressLine, party.city, party.postalCode].filter(Boolean).join(", ") ?? null,
      reference: params.reference ?? null,
      notes: params.notes ?? null,
      createdById: params.createdById ?? null,
      lines: {
        create: clean.map((l, i) => ({
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit ?? null,
          sortOrder: i,
        })),
      },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } }, party: { select: { name: true } } },
  });
}

export async function getDeliveryNote(tenantId: string, noteId: string) {
  return prisma.deliveryNote.findFirst({
    where: { id: noteId, tenantId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      party: true,
      transaction: { select: { id: true, type: true, amountCents: true, createdAt: true } },
    },
  });
}

export async function listDeliveryNotes(tenantId: string, opts: { status?: DeliveryNoteStatus; partyId?: string; take?: number } = {}) {
  return prisma.deliveryNote.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    include: { party: { select: { name: true } }, lines: { select: { quantity: true } } },
  });
}

/** Handed over: who signed, and when. */
export async function markDelivered(
  tenantId: string,
  noteId: string,
  params: { signedBy?: string | null; deliveredAt?: Date; tripStopId?: string | null } = {}
) {
  const note = await prisma.deliveryNote.findFirst({ where: { id: noteId, tenantId }, select: { id: true } });
  if (!note) throw new Error("That delivery note is not in this workspace.");
  return prisma.deliveryNote.update({
    where: { id: noteId },
    data: {
      status: DeliveryNoteStatus.DELIVERED,
      deliveredAt: params.deliveredAt ?? new Date(),
      signedBy: params.signedBy?.trim() || null,
      ...(params.tripStopId ? { tripStopId: params.tripStopId } : {}),
    },
  });
}

export async function markSent(tenantId: string, noteId: string) {
  const note = await prisma.deliveryNote.findFirst({ where: { id: noteId, tenantId }, select: { id: true, status: true } });
  if (!note) throw new Error("That delivery note is not in this workspace.");
  if (note.status !== DeliveryNoteStatus.DRAFT) return note;
  return prisma.deliveryNote.update({ where: { id: noteId }, data: { status: DeliveryNoteStatus.SENT } });
}

export async function deleteDraftNote(tenantId: string, noteId: string) {
  const note = await prisma.deliveryNote.findFirst({ where: { id: noteId, tenantId }, select: { id: true, status: true } });
  if (!note) throw new Error("That delivery note is not in this workspace.");
  if (note.status !== DeliveryNoteStatus.DRAFT) throw new Error("A note that has gone out cannot be deleted — mark it delivered instead.");
  return prisma.deliveryNote.delete({ where: { id: noteId } });
}

/** Customers a note can be written for, for the picker. */
export async function deliverableParties(tenantId: string, take = 200) {
  return prisma.party.findMany({
    where: { tenantId, role: { in: [PartyRole.CUSTOMER, PartyRole.PATIENT] } },
    orderBy: { name: "asc" },
    take,
    select: { id: true, name: true },
  });
}
