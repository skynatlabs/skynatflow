// Single place every AI call in this app gets its model from — proposals,
// email classification, follow-up drafting, onboarding extraction. A
// super-admin picks the provider at /admin/ai (PlatformSetting row, not an
// env var), so switching Claude <-> Gemini takes effect immediately with
// no redeploy. Falls back to whichever provider actually has a key
// configured if the chosen one doesn't, and to null (caller degrades
// gracefully, same as every other external integration here) if neither does.

import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@/lib/db";
import { getPlatformSecret } from "@/lib/platform/apiKeys";

export type AiProvider = "anthropic" | "google" | "openai";

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "google", "openai"];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  google: "Gemini (Google)",
  openai: "GPT (OpenAI)",
};

const KEY_NAME: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Two tiers, at every provider.
 *
 * Not every job needs the expensive model. Choosing which customer a name
 * refers to, reading an amount off a supplier invoice or sorting an email
 * into four buckets are jobs a budget model does as well as a frontier one,
 * at roughly a fifth of the price — and those jobs are most of the volume.
 * Planning a multi-step task and choosing between tools is not; that stays
 * on the smart tier, because a wrong tool call costs far more than the
 * tokens it saved.
 */
export type ModelTier = "smart" | "fast";

export async function getProviderKey(provider: AiProvider): Promise<string | null> {
  return getPlatformSecret(KEY_NAME[provider]);
}

export async function providerHasKey(provider: AiProvider): Promise<boolean> {
  return Boolean(await getProviderKey(provider));
}

export async function getPlatformAiProvider(): Promise<AiProvider> {
  const setting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });
  const chosen = setting?.aiProvider;
  return AI_PROVIDERS.includes(chosen as AiProvider) ? (chosen as AiProvider) : "anthropic";
}

export async function setPlatformAiProvider(provider: AiProvider): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", aiProvider: provider },
    update: { aiProvider: provider },
  });
}

export type ColorSkin =
  | "default"
  | "sunset"
  | "professional"
  | "creative"
  | "futuristic"
  | "jewel"
  | "summer"
  | "admina";

export const COLOR_SKIN_LABELS: Record<ColorSkin, string> = {
  default: "Default (indigo & violet)",
  sunset: "Sunset (charcoal & amber)",
  professional: "Professional (teal, clean & corporate)",
  creative: "Creative (colorful, bold gradients)",
  futuristic: "Futuristic (neon glass, sci-fi)",
  jewel: "Jewel (emerald, mango & magenta)",
  summer: "Summer (cyan, blue, orange, yellow & pink — no gradients)",
  admina: "Admina (blue & slate, dense data-first admin)",
};

const VALID_SKINS: ColorSkin[] = [
  "default",
  "sunset",
  "professional",
  "creative",
  "futuristic",
  "jewel",
  "summer",
  "admina",
];

// Admina is the house look: it is the only skin that changes the navigation
// itself, grouping the app by what someone is doing rather than presenting one
// long list, and it is the one every page here is designed and tested against.
const DEFAULT_SKIN: ColorSkin = "admina";

/**
 * The app has one look: Admina.
 *
 * The other skins are still here — their CSS, their labels, their stored
 * setting — but nothing selects them any more. Every page in this app is
 * designed and tested against Admina's chrome, and the others had drifted
 * into being seven variations nobody maintained. What a person can actually
 * change is the accent colour, which cannot make anything unreadable.
 *
 * Kept as a function rather than inlined so re-enabling the choice later is a
 * one-line change here rather than an archaeology exercise.
 */
const SKIN_CHOICE_ENABLED = false;

export async function getPlatformColorSkin(): Promise<ColorSkin> {
  if (!SKIN_CHOICE_ENABLED) return DEFAULT_SKIN;

  // Kept intact rather than deleted, so restoring the choice is flipping the
  // constant above and re-enabling the buttons on /car/appearance.
  const setting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });
  const skin = setting?.colorSkin;
  return VALID_SKINS.includes(skin as ColorSkin) ? (skin as ColorSkin) : DEFAULT_SKIN;
}

export async function setPlatformColorSkin(skin: ColorSkin): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", colorSkin: skin },
    update: { colorSkin: skin },
  });
}

// The model each provider is called with. Named here rather than at each of
// the dozen call sites, because the whole point of this module is that moving
// to a newer model is one edit and no redeploy of anything else.
//
// Every id is overridable by environment variable, because these move faster
// than deploys do and a model rename should never need a code change.
//
// ONLY the Anthropic ids here are confirmed. The Google and OpenAI ids are
// the current public names as far as we know them and MUST be checked against
// each provider's own model list before that provider is switched on for real
// traffic — a wrong id fails at the first call, loudly, which is the good
// case, but it should not be discovered by a customer.
export const MODELS: Record<AiProvider, Record<ModelTier, string>> = {
  anthropic: {
    smart: process.env.ANTHROPIC_MODEL_SMART ?? "claude-sonnet-5",
    fast: process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5-20251001",
  },
  google: {
    smart: process.env.GOOGLE_MODEL_SMART ?? "gemini-3.1-pro-preview",
    fast: process.env.GOOGLE_MODEL_FAST ?? "gemini-3.8-flash",
  },
  openai: {
    smart: process.env.OPENAI_MODEL_SMART ?? "gpt-5.6-terra",
    fast: process.env.OPENAI_MODEL_FAST ?? "gpt-5.6-luna",
  },
};

// Kept as named exports because a dozen call sites and the cost table still
// refer to "the model we use" without caring about tiers.
export const ANTHROPIC_MODEL = MODELS.anthropic.smart;
export const GOOGLE_MODEL = MODELS.google.smart;
export const OPENAI_MODEL = MODELS.openai.smart;

export function modelIdFor(provider: AiProvider, tier: ModelTier = "smart"): string {
  return MODELS[provider][tier];
}

async function modelFor(provider: AiProvider, tier: ModelTier = "smart") {
  const apiKey = await getProviderKey(provider);
  if (!apiKey) return null;
  const id = modelIdFor(provider, tier);
  if (provider === "google") return createGoogleGenerativeAI({ apiKey })(id);
  if (provider === "openai") return createOpenAI({ apiKey })(id);
  return createAnthropic({ apiKey })(id);
}

// Returns null when nothing is configured — every call site already
// treats a null/missing model as "skip the AI step" (this app's
// established graceful-degradation pattern), so nothing here should throw.
export async function getAiModel(tier: ModelTier = "smart") {
  const chosen = await getPlatformAiProvider();
  for (const provider of orderFrom(chosen)) {
    const model = await modelFor(provider, tier);
    if (model) return model;
  }
  return null;
}

/** The chosen provider first, then the others, so a missing key is never fatal. */
function orderFrom(chosen: AiProvider): AiProvider[] {
  return [chosen, ...AI_PROVIDERS.filter((p) => p !== chosen)];
}

/**
 * Every provider that could serve a request, best first.
 *
 * getAiModel falls back when a provider has no key, which covers the setup
 * case and nothing else. This covers the one that actually happens: a
 * provider that is configured, has credit, and is having a bad afternoon.
 * The caller tries them in order — see agent/runtime.ts — so an outage at one
 * vendor is a slower answer rather than no answer.
 */
export async function aiModelChain(params?: {
  tier?: ModelTier;
  /** A workspace that has picked its own provider; falls back to the platform's. */
  tenantId?: string | null;
}): Promise<Array<{ provider: AiProvider; model: LanguageModel; modelId: string }>> {
  const tier = params?.tier ?? "smart";
  const chosen = params?.tenantId
    ? await getTenantAiProvider(params.tenantId)
    : await getPlatformAiProvider();

  const chain: Array<{ provider: AiProvider; model: LanguageModel; modelId: string }> = [];
  for (const provider of orderFrom(chosen)) {
    const model = await modelFor(provider, tier);
    if (model) chain.push({ provider, model, modelId: modelIdFor(provider, tier) });
  }
  return chain;
}

/**
 * Which tier the agent loop itself thinks on.
 *
 * Fast by default. The reasoning is in the schema comment, and the short
 * version is that tool subsetting made the cheap model viable: picking from
 * forty relevant tools is a far easier job than picking from 332, so the two
 * changes only work together.
 *
 * Note what the model is and is not doing here. It never performs arithmetic
 * — every figure comes back from a core function that the dashboard calls
 * too. What a weaker model risks is choosing the wrong tool, not producing a
 * wrong number, and anything that moves money is held by the autonomy gate
 * before it happens regardless of which model proposed it.
 */
export async function getAgentTier(tenantId?: string | null): Promise<ModelTier> {
  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiTier: true },
    });
    if (tenant?.aiTier === "smart" || tenant?.aiTier === "fast") return tenant.aiTier;
  }
  const setting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });
  return setting?.agentTier === "smart" ? "smart" : "fast";
}

export async function setPlatformAgentTier(tier: ModelTier): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", agentTier: tier },
    update: { agentTier: tier },
  });
}

export async function setTenantAgentTier(tenantId: string, tier: ModelTier | null): Promise<void> {
  await prisma.tenant.update({ where: { id: tenantId }, data: { aiTier: tier } });
}

/**
 * The provider a specific workspace runs on.
 *
 * A workspace may pick its own — some businesses have a view about whose
 * model reads their books, and for an enterprise buyer that view sometimes
 * arrives as a procurement condition rather than a preference. Unset means
 * "whatever the platform is using", which is what almost every workspace
 * will leave it as.
 */
export async function getTenantAiProvider(tenantId: string): Promise<AiProvider> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { aiProvider: true },
  });
  const chosen = tenant?.aiProvider;
  if (chosen && AI_PROVIDERS.includes(chosen as AiProvider)) return chosen as AiProvider;
  return getPlatformAiProvider();
}

export async function setTenantAiProvider(tenantId: string, provider: AiProvider | null): Promise<void> {
  await prisma.tenant.update({ where: { id: tenantId }, data: { aiProvider: provider } });
}

/**
 * Whether an error is worth trying the next provider for.
 *
 * A rate limit, an outage or a timeout is: the same request may well work
 * elsewhere. A refusal or a malformed request is not — retrying it at another
 * vendor produces the same refusal, more slowly and at twice the cost.
 */
export function worthFailingOver(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/invalid|unsupported|schema|refus|content filter|safety/.test(message)) return false;
  return /rate.?limit|overload|timeout|timed out|unavailable|5\d\d|econn|network|fetch failed|capacity|credit|quota/.test(message);
}

// ---------------------------------------------------------------- accents
//
// The one visual choice a person gets. It moves the three accent tokens and
// nothing else: surfaces, text and borders stay exactly as Admina sets them,
// in light and dark alike. That constraint is the point — a palette picker
// that can leave somebody with grey text on a grey card is a support ticket
// waiting to happen, and this one cannot.

export type AccentPalette =
  | "blue"
  | "violet"
  | "emerald"
  | "teal"
  | "amber"
  | "pink"
  | "blush"
  | "red";

export const ACCENT_PALETTES: Record<
  AccentPalette,
  { label: string; note: string; a: string; mid: string; b: string }
> = {
  blue: {
    label: "Blue",
    note: "The default. Calm, and what the app was designed around.",
    a: "#487fff",
    mid: "#519fff",
    b: "#45b369",
  },
  violet: {
    label: "Violet",
    note: "Deeper and a little softer than the blue.",
    a: "#7c5cff",
    mid: "#9b82ff",
    b: "#45b369",
  },
  emerald: {
    label: "Emerald",
    note: "Green primary actions. Reads well for money-heavy work.",
    a: "#10a37f",
    mid: "#34c79b",
    b: "#487fff",
  },
  teal: {
    label: "Teal",
    note: "Cooler than the emerald, closer to the blue it replaces.",
    a: "#0d9488",
    mid: "#2dd4bf",
    b: "#487fff",
  },
  amber: {
    label: "Amber",
    note: "Warm and high-contrast, without going all the way to red.",
    a: "#e08700",
    mid: "#f5a524",
    b: "#487fff",
  },
  pink: {
    label: "Pink",
    note: "Clear magenta-pink on the buttons and key figures.",
    a: "#ec4899",
    mid: "#f472b6",
    b: "#487fff",
  },
  blush: {
    // accent-mid is the gradient partner for accent-a, so setting it to amber
    // is what makes gradients actually run pink into amber rather than pink
    // into a lighter pink.
    label: "Pink & amber",
    note: "Pink that warms into amber across gradients and highlights.",
    a: "#ef5da8",
    mid: "#f5a524",
    b: "#487fff",
  },
  red: {
    label: "Red",
    note: "Strong and direct. The highest-contrast option of the six.",
    a: "#dc2626",
    mid: "#ef4444",
    b: "#487fff",
  },
};

export const DEFAULT_ACCENT: AccentPalette = "blue";

const VALID_ACCENTS = Object.keys(ACCENT_PALETTES) as AccentPalette[];

export function isAccentPalette(value: unknown): value is AccentPalette {
  return typeof value === "string" && VALID_ACCENTS.includes(value as AccentPalette);
}

/**
 * The accent a particular person sees.
 *
 * Falls back silently when the stored value names a palette that no longer
 * exists — nobody should be shown an error about a colour.
 */
export async function getAccentForUser(
  userId: string | null | undefined
): Promise<AccentPalette> {
  if (!userId) return DEFAULT_ACCENT;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accentPalette: true },
  });
  return isAccentPalette(user?.accentPalette) ? user.accentPalette : DEFAULT_ACCENT;
}

/** Set a person's accent. Null returns them to the default. */
export async function setAccentForUser(
  userId: string,
  accent: AccentPalette | null
): Promise<void> {
  if (accent !== null && !isAccentPalette(accent)) throw new Error("No such palette.");
  await prisma.user.update({ where: { id: userId }, data: { accentPalette: accent } });
}
