// Single place every AI call in this app gets its model from — proposals,
// email classification, follow-up drafting, onboarding extraction. A
// super-admin picks the provider at /admin/ai (PlatformSetting row, not an
// env var), so switching Claude <-> Gemini takes effect immediately with
// no redeploy. Falls back to whichever provider actually has a key
// configured if the chosen one doesn't, and to null (caller degrades
// gracefully, same as every other external integration here) if neither does.

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { prisma } from "@/lib/db";

export type AiProvider = "anthropic" | "google";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  google: "Gemini (Google)",
};

export function providerHasKey(provider: AiProvider): boolean {
  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export async function getPlatformAiProvider(): Promise<AiProvider> {
  const setting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });
  return setting?.aiProvider === "google" ? "google" : "anthropic";
}

export async function setPlatformAiProvider(provider: AiProvider): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", aiProvider: provider },
    update: { aiProvider: provider },
  });
}

function modelFor(provider: AiProvider) {
  return provider === "google" ? google("gemini-2.5-pro") : anthropic("claude-sonnet-4-5");
}

// Returns null when nothing is configured — every call site already
// treats a null/missing model as "skip the AI step" (this app's
// established graceful-degradation pattern), so nothing here should throw.
export async function getAiModel() {
  const chosen = await getPlatformAiProvider();
  if (providerHasKey(chosen)) return modelFor(chosen);

  const fallback: AiProvider = chosen === "anthropic" ? "google" : "anthropic";
  if (providerHasKey(fallback)) return modelFor(fallback);

  return null;
}
