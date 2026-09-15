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

async function modelFor(provider: AiProvider) {
  const apiKey = await getProviderKey(provider);
  if (!apiKey) return null;
  return provider === "google"
    ? createGoogleGenerativeAI({ apiKey })("gemini-3.1-pro-preview")
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
