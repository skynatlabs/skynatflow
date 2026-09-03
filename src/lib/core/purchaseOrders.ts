// PA job: turning a reorder suggestion into a real, sendable purchase
// order — the demand engine (src/lib/core/inventory.ts) already tells an
// owner what and how much to reorder; this is the missing "now actually
// send it to the supplier" step.

import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email/client";
import { getReorderSuggestions } from "./inventory";

export interface PurchaseOrderLineInput {
  itemId: string;
  quantity: number;
  unitCostCents: number;
}

export async function createPurchaseOrder(params: {
  tenantId: string;
  supplierId: string;
  lines: PurchaseOrderLineInput[];
}) {
  if (!params.lines.length) throw new Error("A purchase order needs at least one line.");

  const totalCostCents = params.lines.reduce((sum, l) => sum + l.quantity * l.unitCostCents, 0);

  return prisma.purchaseOrder.create({
    data: {
      tenantId: params.tenantId,
      supplierId: params.supplierId,
      totalCostCents,
      lines: { create: params.lines },
    },
    include: { lines: { include: { item: true } }, supplier: true },
  });
}

// Builds the lines a PO would need straight from the demand engine's own
// reorder sizing — an owner reviewing this should see the exact same
// numbers the inventory heatmap already showed them, not a second
// disconnected calculation.
export async function buildPurchaseOrderLinesFromReorderSuggestions(
  tenantId: string,
  itemIds: string[]
): Promise<PurchaseOrderLineInput[]> {
  const suggestions = await getReorderSuggestions(tenantId);
  const items = await prisma.item.findMany({ where: { tenantId, id: { in: itemIds } } });
  const costByItem = new Map(items.map((i) => [i.id, i.costCents ?? i.unitPriceCents]));

  return suggestions
    .filter((s) => itemIds.includes(s.itemId))
    .map((s) => ({
      itemId: s.itemId,
      quantity: s.suggestedQty,
      unitCostCents: costByItem.get(s.itemId) ?? 0,
    }));
}

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export async function sendPurchaseOrder(
  tenantId: string,
  purchaseOrderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: { include: { item: true } }, supplier: true, tenant: true },
  });
  if (!po || po.tenantId !== tenantId) throw new Error("Purchase order not found.");

  if (!po.supplier.email) {
    return { ok: false, reason: "This supplier has no email on file — send it another way, or add their email first." };
  }

  const rows = po.lines
    .map((l) => `<tr><td>${l.item.name}</td><td>${l.quantity}</td><td>${money(l.unitCostCents)}</td><td>${money(l.quantity * l.unitCostCents)}</td></tr>`)
    .join("");

  try {
    await sendEmail({
      to: po.supplier.email,
      subject: `Purchase order from ${po.tenant.name}`,
      html: `
        <p>Hi ${po.supplier.name},</p>
        <p>Please supply the following:</p>
        <table border="1" cellpadding="6" style="border-collapse:collapse">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p><strong>Order total: ${money(po.totalCostCents)}</strong></p>
        <p>Thanks,<br/>${po.tenant.name}</p>
      `,
    });
  } catch {
    return { ok: false, reason: "Couldn't send the email right now — please try again in a moment." };
  }

  await prisma.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: "SENT", sentAt: new Date() } });
  return { ok: true };
}

export async function markPurchaseOrderReceived(tenantId: string, purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: { include: { item: true } } },
  });
  if (!po || po.tenantId !== tenantId) throw new Error("Purchase order not found.");

  // Receiving a PO is a real stock movement — bump each line's item up by
  // the ordered quantity, same "surface it in the real number" posture
  // as the rest of the inventory system. `increment` on a null stockQty
  // (a service/non-stock item on the PO) throws, so those just start
  // from 0 instead — a PO line for a non-stock item is unusual but
  // shouldn't crash the whole receipt.
  await prisma.$transaction([
    ...po.lines.map((l) =>
      prisma.item.update({
        where: { id: l.itemId },
        data: { stockQty: (l.item.stockQty ?? 0) + l.quantity },
      })
    ),
    prisma.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: "RECEIVED", receivedAt: new Date() } }),
  ]);
}

export async function listPurchaseOrders(tenantId: string) {
  return prisma.purchaseOrder.findMany({
    where: { tenantId },
    include: { supplier: true, lines: { include: { item: true } } },
    orderBy: { createdAt: "desc" },
  });
}
