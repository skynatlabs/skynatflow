"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { setPlatformSecret, clearPlatformSecret } from "@/lib/platform/apiKeys";

export async function setApiKeyAction(formData: FormData) {
  await requireSuperAdmin();
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  await setPlatformSecret(key, value);
  revalidatePath("/car/api-keys");
}

export async function clearApiKeyAction(formData: FormData) {
  await requireSuperAdmin();
  const key = String(formData.get("key") ?? "");
  await clearPlatformSecret(key);
  revalidatePath("/car/api-keys");
}
