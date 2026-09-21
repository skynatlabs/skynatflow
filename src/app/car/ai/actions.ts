"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import {
  AI_PROVIDERS,
  setPlatformAiProvider,
  setPlatformAgentTier,
  type AiProvider,
  type ModelTier,
} from "@/lib/ai/model";

export async function setAiProviderAction(formData: FormData) {
  await requireSuperAdmin();
  const provider = String(formData.get("provider") ?? "") as AiProvider;
  if (!AI_PROVIDERS.includes(provider)) {
    throw new Error("Unknown provider.");
  }
  await setPlatformAiProvider(provider);
  revalidatePath("/car/ai");
}

/**
 * Which tier the agent loop runs on, platform-wide.
 *
 * Here rather than in a constant because it is the one setting whose effect
 * on answer quality cannot be measured offline. If the cheap model turns out
 * to reason badly about a real workspace, this is a click.
 */
export async function setAgentTierAction(formData: FormData) {
  await requireSuperAdmin();
  const tier = String(formData.get("tier") ?? "") as ModelTier;
  if (tier !== "fast" && tier !== "smart") throw new Error("Unknown tier.");
  await setPlatformAgentTier(tier);
  revalidatePath("/car/ai");
}
