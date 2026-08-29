"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

const LOCKED_STATUSES = new Set(["ACCEPTED", "DECLINED", "CANCELLED"]);

export async function updateQuoteLinesAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "quote:create");

  const quote = await prisma.transaction.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.tenantId !== tenantId || quote.type !== "QUOTE") throw new Error("Not found.");
  if (LOCKED_STATUSES.has(quote.status)) {
    throw new Error("This quote has already been decided and can't be edited.");
  }

  const lineItemIds = formData.getAll("lineItemId").map(String);
  const lineItemNames = formData.getAll("lineItemName").map((v) => String(v).trim());
  const lineQuantities = formData.getAll("lineQuantity").map((v) => Number(v) || 1);
  const linePriceRands = formData.getAll("linePriceRand").map((v) => Number(v) || 0);

  const rows = lineItemNames
    .map((itemName, i) => ({
      itemId: lineItemIds[i] ?? "",
      itemName,
      quantity: lineQuantities[i] ?? 1,
      priceRand: linePriceRands[i] ?? 0,
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
    lines.push({ itemId: item.id, quantity: row.quantity, unitPriceCents: Math.round(row.priceRand * 100) });
  }

  const amountCents = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  // Replace, not append — a re-edit reflects the current state of the
  // quote, not a running history of every line ever typed in.
  await prisma.$transaction([
    prisma.transactionLine.deleteMany({ where: { transactionId: quoteId } }),
    prisma.transaction.update({
      where: { id: quoteId },
      data: { amountCents, itemLines: { create: lines } },
    }),
  ]);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "quote:create",
    targetType: "Transaction",
    targetId: quoteId,
    metadata: { action: "edited", amountCents },
  });

  redirect(`/dashboard/${tenantId}/quotes/${quoteId}`);
}
