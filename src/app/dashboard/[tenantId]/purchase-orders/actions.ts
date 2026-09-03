"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createParty } from "@/lib/core/parties";
import {
  createPurchaseOrder,
  buildPurchaseOrderLinesFromReorderSuggestions,
  sendPurchaseOrder,
  markPurchaseOrderReceived,
} from "@/lib/core/purchaseOrders";

export async function addSupplierAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  if (!name) throw new Error("Supplier name is required.");

  await createParty({ tenantId, role: "SUPPLIER", name, email, phone });
  revalidatePath(`/dashboard/${tenantId}/purchase-orders`);
}

export async function createPurchaseOrderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const supplierId = String(formData.get("supplierId") ?? "");
  const itemIds = formData.getAll("itemId").map(String);
  if (!supplierId) throw new Error("Choose a supplier.");
  if (!itemIds.length) throw new Error("Select at least one item to reorder.");

  const lines = await buildPurchaseOrderLinesFromReorderSuggestions(tenantId, itemIds);
  await createPurchaseOrder({ tenantId, supplierId, lines });
  revalidatePath(`/dashboard/${tenantId}/purchase-orders`);
}

export async function sendPurchaseOrderAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  await sendPurchaseOrder(tenantId, purchaseOrderId);
  revalidatePath(`/dashboard/${tenantId}/purchase-orders`);
}

export async function markReceivedAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  await markPurchaseOrderReceived(tenantId, purchaseOrderId);
  revalidatePath(`/dashboard/${tenantId}/purchase-orders`);
}
