"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";
import { computeDocumentTotal } from "@/lib/core/pricing";

const LOCKED_STATUSES = new Set(["PAID", "PARTIALLY_PAID", "CANCELLED"]);

export async function updateInvoiceLinesAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "invoice:create");

  const invoice = await prisma.transaction.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.tenantId !== tenantId || invoice.type !== "INVOICE") throw new Error("Not found.");
  if (LOCKED_STATUSES.has(invoice.status)) {
    throw new Error("A paid or refunded invoice can't be edited.");
  }

  const lineItemIds = formData.getAll("lineItemId").map(String);
  const lineItemNames = formData.getAll("lineItemName").map((v) => String(v).trim());
  const lineQuantities = formData.getAll("lineQuantity").map((v) => Number(v) || 1);
  const linePriceRands = formData.getAll("linePriceRand").map((v) => Number(v) || 0);
  const lineDiscountPercents = formData.getAll("lineDiscountPercent").map((v) => Number(v) || 0);
  const lineTaxRatePercents = formData.getAll("lineTaxRatePercent").map((v) => (v === "" ? null : Number(v)));
  const documentDiscountPercent = Number(formData.get("documentDiscountPercent") ?? 0) || 0;
  const subject = String(formData.get("subject") ?? "").trim();
  const poNumber = String(formData.get("poNumber") ?? "").trim();

  const rows = lineItemNames
    .map((itemName, i) => ({
      itemId: lineItemIds[i] ?? "",
      itemName,
      quantity: lineQuantities[i] ?? 1,
      priceRand: linePriceRands[i] ?? 0,
      discountPercent: lineDiscountPercents[i] ?? 0,
      taxRatePercent: lineTaxRatePercents[i] ?? null,
    }))
    .filter((r) => r.itemName && r.priceRand > 0);

  if (rows.length === 0) throw new Error("At least one item is required.");

  const lines = [];
  for (const row of rows) {
    const catalogMatch = row.itemId
      ? await prisma.item.findFirst({ where: { id: row.itemId, tenantId, name: row.itemName } })
      : null;
    const item =
      catalogMatch ??
      (await prisma.item.create({
        data: { tenantId, name: row.itemName, unitPriceCents: Math.round(row.priceRand * 100) },
      }));
    lines.push({
      itemId: item.id,
      quantity: row.quantity,
      unitPriceCents: Math.round(row.priceRand * 100),
      discountPercent: row.discountPercent,
      taxRatePercent: row.taxRatePercent,
    });
  }

  const { totalCents: amountCents } = computeDocumentTotal(lines, documentDiscountPercent);

  await prisma.$transaction([
    prisma.transactionLine.deleteMany({ where: { transactionId: invoiceId } }),
    prisma.transaction.update({
      where: { id: invoiceId },
      data: {
        amountCents,
        discountPercent: documentDiscountPercent,
        subject: subject || null,
        poNumber: poNumber || null,
        itemLines: { create: lines },
      },
    }),
  ]);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "invoice:create",
    targetType: "Transaction",
    targetId: invoiceId,
    metadata: { action: "edited", amountCents },
  });

  redirect(`/dashboard/${tenantId}/invoices/${invoiceId}`);
}
