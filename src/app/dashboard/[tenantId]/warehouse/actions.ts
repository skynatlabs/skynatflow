"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { saveBin, putAway, moveStock, countBin } from "@/lib/core/warehouse";

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/warehouse`);
}

export async function saveBinAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await saveBin({
    tenantId,
    code: String(formData.get("code") ?? ""),
    pickSequence: Number(formData.get("pickSequence") ?? 0),
    isPickable: formData.get("isPickable") === "on",
    note: String(formData.get("note") ?? "") || null,
  });

  refresh(tenantId);
}

export async function putAwayAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await putAway({
    tenantId,
    binId: String(formData.get("binId")),
    itemId: String(formData.get("itemId")),
    quantity: Number(formData.get("quantity") ?? 0),
  });

  refresh(tenantId);
}

export async function moveStockAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await moveStock({
    tenantId,
    fromBinId: String(formData.get("fromBinId")),
    toBinId: String(formData.get("toBinId")),
    itemId: String(formData.get("itemId")),
    quantity: Number(formData.get("quantity") ?? 0),
  });

  refresh(tenantId);
}

/** A count sets the bin. Variances are returned by the module, not swallowed. */
export async function countBinAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const access = await requireTenantAccess(tenantId);
  assertCan(access, "product:manage");

  await countBin({
    tenantId,
    binId: String(formData.get("binId")),
    counts: [
      {
        itemId: String(formData.get("itemId")),
        countedQty: Number(formData.get("countedQty") ?? 0),
      },
    ],
  });

  refresh(tenantId);
}
