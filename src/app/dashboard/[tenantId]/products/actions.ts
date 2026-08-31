"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createProduct, updateProduct, setProductActive } from "@/lib/core/catalog";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { recordAudit } from "@/lib/core/audit";

function readProductFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const hsnCode = String(formData.get("hsnCode") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const priceRand = Number(formData.get("priceRand") ?? 0);
  const costRand = formData.get("costRand") ? Number(formData.get("costRand")) : undefined;
  const taxRatePercent = formData.get("taxRatePercent")
    ? Number(formData.get("taxRatePercent"))
    : undefined;
  const stockQty = formData.get("stockQty") ? Number(formData.get("stockQty")) : undefined;
  const reorderPoint = formData.get("reorderPoint")
    ? Number(formData.get("reorderPoint"))
    : undefined;

  if (!name || !priceRand) {
    throw new Error("Name and price are required.");
  }

  return {
    name,
    sku: sku || undefined,
    hsnCode: hsnCode || undefined,
    category: category || undefined,
    imageUrl: imageUrl || undefined,
    unitPriceCents: Math.round(priceRand * 100),
    costCents: costRand !== undefined ? Math.round(costRand * 100) : undefined,
    taxRatePercent,
    stockQty,
    reorderPoint,
  };
}

export async function createProductAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const fields = readProductFields(formData);
  const product = await createProduct({ tenantId, ...fields });

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "product:manage",
    targetType: "Item",
    targetId: product.id,
    metadata: { action: "create", name: product.name },
  });

  redirect(`/dashboard/${tenantId}/products`);
}

export async function updateProductAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const existing = await prisma.item.findUniqueOrThrow({ where: { id: productId } });
  if (existing.tenantId !== tenantId) throw new Error("Not found.");

  const fields = readProductFields(formData);
  await updateProduct(productId, fields);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "product:manage",
    targetType: "Item",
    targetId: productId,
    metadata: { action: "update", name: fields.name },
  });

  redirect(`/dashboard/${tenantId}/products`);
}

export async function toggleProductActiveAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const nextActive = String(formData.get("nextActive") ?? "true") === "true";
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "product:manage");

  const existing = await prisma.item.findUniqueOrThrow({ where: { id: productId } });
  if (existing.tenantId !== tenantId) throw new Error("Not found.");

  await setProductActive(productId, nextActive);

  await recordAudit({
    tenantId,
    actorType: "user",
    actorId: access.userId,
    capability: "product:manage",
    targetType: "Item",
    targetId: productId,
    metadata: { action: nextActive ? "unhide" : "hide" },
  });

  redirect(`/dashboard/${tenantId}/products`);
}
