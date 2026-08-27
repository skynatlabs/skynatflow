"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { connectDocBackup, disconnectDocBackup } from "@/lib/core/docBackup";

export async function connectBackupAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await connectDocBackup(tenantId, "google_drive");
  revalidatePath(`/dashboard/${tenantId}/settings/backup`);
}

export async function disconnectBackupAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await disconnectDocBackup(tenantId);
  revalidatePath(`/dashboard/${tenantId}/settings/backup`);
}
