"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { setPlatformVoiceProvider } from "@/lib/voice/synthesize";

export async function setVoiceProviderAction(formData: FormData) {
  await requireSuperAdmin();
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "browser" && provider !== "google") {
    throw new Error("Unknown provider.");
  }
  await setPlatformVoiceProvider(provider);
  revalidatePath("/admin/voice");
}
