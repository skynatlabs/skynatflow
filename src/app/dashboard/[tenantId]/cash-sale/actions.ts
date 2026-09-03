"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { recordCashSale } from "@/lib/core/money";
import { createParty, getOrCreateWalkInParty } from "@/lib/core/parties";
import { PartyRole } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

export async function recordCashSaleAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "payment:record");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const customerName = String(formData.get("customerName") ?? "").trim();
  const itemName = String(formData.get("itemName") ?? "").trim();
  const itemId = String(formData.get("itemId") ?? "").trim();
  const priceRand = Number(formData.get("priceRand") ?? 0);
  const quantity = Number(formData.get("quantity") ?? 1);

  if (!itemName || !(priceRand > 0) || !(quantity > 0)) {
    throw new Error("Item, a price greater than zero, and a quantity greater than zero are required.");
  }

  const role = tenant.niche === "MEDICAL" ? PartyRole.PATIENT : PartyRole.CUSTOMER;
  const party = customerName
    ? await createParty({ tenantId, role, name: customerName })
    : await getOrCreateWalkInParty(tenantId, role);

  const catalogMatch = itemId
    ? await prisma.item.findFirst({ where: { id: itemId, tenantId, name: itemName } })
    : null;
  const item =
    catalogMatch ??
    (await prisma.item.create({
      data: { tenantId, name: itemName, unitPriceCents: Math.round(priceRand * 100) },
    }));

  const invoice = await recordCashSale({
    tenantId,
    partyId: party.id,
    lines: [{ itemId: item.id, quantity, unitPriceCents: Math.round(priceRand * 100) }],
  });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "payment:record",
    targetType: "Transaction",
    targetId: invoice.id,
    metadata: { action: "cash-sale", amountCents: invoice.amountCents, customerId: party.id },
  });

  redirect(`/dashboard/${tenantId}?sold=1`);
}
