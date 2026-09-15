// Delivery notes.
//
// The property that matters is arithmetic, not paperwork: a part delivery
// leaves the rest outstanding, and the next note starts from what is left
// rather than from the whole order again.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  createDeliveryNote,
  deleteDraftNote,
  deliveredSoFar,
  getDeliveryNote,
  markDelivered,
  markSent,
  nextDeliveryNumber,
  outstandingLines,
} from "../../src/lib/core/deliveryNotes";

let tenantId: string;
let otherTenantId: string;
let partyId: string;
let invoiceId: string;
let wrapId: string;
let strapId: string;

beforeEach(async () => {
  const t = await prisma.tenant.create({ data: { name: "Slip Co", niche: "WHOLESALE" } });
  tenantId = t.id;
  const other = await prisma.tenant.create({ data: { name: "Other Co", niche: "RETAIL" } });
  otherTenantId = other.id;

  const party = await prisma.party.create({ data: { tenantId, name: "Jabu Traders", role: "CUSTOMER", addressLine: "9 Main Road", city: "Midrand" } });
  partyId = party.id;
  const wrap = await prisma.item.create({ data: { tenantId, name: "Pallet wrap", unitPriceCents: 18_900, unit: "roll" } });
  const strap = await prisma.item.create({ data: { tenantId, name: "Ratchet strap", unitPriceCents: 9_900 } });
  wrapId = wrap.id;
  strapId = strap.id;

  const invoice = await prisma.transaction.create({
    data: { tenantId, partyId, type: "INVOICE", status: "SENT", amountCents: 145_800 },
  });
  invoiceId = invoice.id;
  await prisma.transactionLine.createMany({
    data: [
      { transactionId: invoiceId, itemId: wrapId, quantity: 6, unitPriceCents: 18_900, sortOrder: 0 },
      { transactionId: invoiceId, itemId: strapId, quantity: 4, unitPriceCents: 9_900, sortOrder: 1 },
    ],
  });
});

afterEach(async () => {
  for (const id of [tenantId, otherTenantId]) {
    await prisma.deliveryNoteLine.deleteMany({ where: { note: { tenantId: id } } });
    await prisma.deliveryNote.deleteMany({ where: { tenantId: id } });
    await prisma.transactionLine.deleteMany({ where: { transaction: { tenantId: id } } });
    await prisma.transaction.deleteMany({ where: { tenantId: id } });
    await prisma.item.deleteMany({ where: { tenantId: id } });
    await prisma.party.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });
  }
});

describe("what went out of the door", () => {
  it("starts from the whole order, and numbers itself", async () => {
    expect(await nextDeliveryNumber(tenantId)).toBe("DN-0001");

    const note = await createDeliveryNote({ tenantId, transactionId: invoiceId });
    expect(note.number).toBe("DN-0001");
    expect(note.lines.map((l) => [l.description, l.quantity, l.unit])).toEqual([
      ["Pallet wrap", 6, "roll"],
      ["Ratchet strap", 4, null],
    ]);
    // The customer and their address come off the invoice.
    expect(note.partyId).toBe(partyId);
    expect(note.deliveryAddress).toContain("Midrand");

    const second = await createDeliveryNote({ tenantId, partyId, lines: [{ description: "Spare pallet", quantity: 1 }] });
    expect(second.number).toBe("DN-0002");
  });

  it("leaves the rest outstanding when only part of the order goes", async () => {
    const first = await createDeliveryNote({
      tenantId,
      transactionId: invoiceId,
      lines: [{ itemId: wrapId, description: "Pallet wrap", quantity: 4, unit: "roll" }],
    });
    // A draft has not gone anywhere, so nothing is counted against the order yet.
    expect((await deliveredSoFar(tenantId, invoiceId)).size).toBe(0);
    await markSent(tenantId, first.id);

    const delivered = await deliveredSoFar(tenantId, invoiceId);
    expect(delivered.get(wrapId)).toBe(4);

    const left = await outstandingLines(tenantId, invoiceId);
    expect(left).toEqual([
      { itemId: wrapId, description: "Pallet wrap", quantity: 2, unit: "roll" },
      { itemId: strapId, description: "Ratchet strap", quantity: 4, unit: null },
    ]);

    // The next note starts from what is left, not from the order again.
    const second = await createDeliveryNote({ tenantId, transactionId: invoiceId });
    expect(second.lines.map((l) => [l.description, l.quantity])).toEqual([
      ["Pallet wrap", 2],
      ["Ratchet strap", 4],
    ]);
    await markSent(tenantId, second.id);

    await expect(createDeliveryNote({ tenantId, transactionId: invoiceId })).rejects.toThrow(/nothing left to deliver/i);
  });

  it("records who signed for it, and refuses to delete a note that has gone", async () => {
    const note = await createDeliveryNote({ tenantId, transactionId: invoiceId });
    await markSent(tenantId, note.id);
    await expect(deleteDraftNote(tenantId, note.id)).rejects.toThrow(/cannot be deleted/i);

    await markDelivered(tenantId, note.id, { signedBy: "J Dube" });
    const after = await getDeliveryNote(tenantId, note.id);
    expect(after?.status).toBe("DELIVERED");
    expect(after?.signedBy).toBe("J Dube");
    expect(after?.deliveredAt).not.toBeNull();
  });

  it("will not write a note against another workspace's document, customer or product", async () => {
    const otherParty = await prisma.party.create({ data: { tenantId: otherTenantId, name: "Not yours", role: "CUSTOMER" } });
    const otherInvoice = await prisma.transaction.create({
      data: { tenantId: otherTenantId, partyId: otherParty.id, type: "INVOICE", status: "SENT", amountCents: 100 },
    });

    await expect(createDeliveryNote({ tenantId, transactionId: otherInvoice.id })).rejects.toThrow(/not in this workspace/i);
    await expect(createDeliveryNote({ tenantId, partyId: otherParty.id, lines: [{ description: "x", quantity: 1 }] })).rejects.toThrow(
      /not in this workspace/i
    );
    const otherItem = await prisma.item.create({ data: { tenantId: otherTenantId, name: "Theirs", unitPriceCents: 1 } });
    await expect(
      createDeliveryNote({ tenantId, partyId, lines: [{ itemId: otherItem.id, description: "Theirs", quantity: 1 }] })
    ).rejects.toThrow(/not in this workspace/i);
    await expect(markDelivered(tenantId, "not-a-note")).rejects.toThrow(/not in this workspace/i);

    expect(await prisma.deliveryNote.count({ where: { tenantId } })).toBe(0);
  });
});
