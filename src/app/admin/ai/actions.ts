"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { setPlatformAiProvider, type AiProvider } from "@/lib/ai/model";

export async function setAiProviderAction(formData: FormData) {
  await requireSuperAdmin();
  const provider = String(formData.get("provider") ?? "") as AiProvider;
  if (provider !== "anthropic" && provider !== "google") {
    throw new Error("Unknown provider.");
  }
  await setPlatformAiProvider(provider);
  revalidatePath("/admin/ai");
}
