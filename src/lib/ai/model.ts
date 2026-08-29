// Single place every AI call in this app gets its model from — proposals,
// email classification, follow-up drafting, onboarding extraction. A
// super-admin picks the provider at /admin/ai (PlatformSetting row, not an
// env var), so switching Claude <-> Gemini takes effect immediately with
// no redeploy. Falls back to whichever provider actually has a key
// configured if the chosen one doesn't, and to null (caller degrades
// gracefully, same as every other external integration here) if neither does.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { prisma } from "@/lib/db";
import { getPlatformSecret } from "@/lib/platform/apiKeys";

export type AiProvider = "anthropic" | "google";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  google: "Gemini (Google)",
};

const KEY_NAME: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export async function getProviderKey(provider: AiProvider): Promise<string | null> {
  return getPlatformSecret(KEY_NAME[provider]);
}

export async function providerHasKey(provider: AiProvider): Promise<boolean> {
  return Boolean(await getProviderKey(provider));
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

async function modelFor(provider: AiProvider) {
  const apiKey = await getProviderKey(provider);
  if (!apiKey) return null;
  return provider === "google"
    ? createGoogleGenerativeAI({ apiKey })("gemini-2.5-pro")
    : createAnthropic({ apiKey })("claude-sonnet-4-5");
}

// Returns null when nothing is configured — every call site already
// treats a null/missing model as "skip the AI step" (this app's
// established graceful-degradation pattern), so nothing here should throw.
export async function getAiModel() {
  const chosen = await getPlatformAiProvider();
  const primary = await modelFor(chosen);
  if (primary) return primary;

  const fallback: AiProvider = chosen === "anthropic" ? "google" : "anthropic";
  return modelFor(fallback);
}
