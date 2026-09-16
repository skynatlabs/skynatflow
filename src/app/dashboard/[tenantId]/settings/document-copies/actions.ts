"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { chooseProvider, type DriveProvider } from "@/lib/core/documentBackup";

export async function chooseDriveAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  if (!can(access.role, "staff:manage")) throw new Error("Only an owner can send copies of the business's documents anywhere.");

  const raw = String(formData.get("provider") ?? "");
  const provider = raw === "" ? null : (raw as DriveProvider);
  await chooseProvider(tenantId, provider);

  revalidatePath(`/dashboard/${tenantId}/settings/document-copies`);
}
