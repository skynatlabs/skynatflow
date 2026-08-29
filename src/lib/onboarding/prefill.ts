// "Paste a link, we set most of it up" — the onboarding-friction reducer.
// Fetches the given URL and asks the model to extract structured signals
// to prefill the onboarding form. Degrades to a plain empty form if
// ANTHROPIC_API_KEY isn't configured or the fetch/extraction fails —
// never blocks onboarding, same graceful-degradation pattern used
// throughout this app.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { NICHE_CONFIGS } from "@/lib/niches/config";

const PrefillSchema = z.object({
  businessName: z.string().nullable(),
  suggestedNiche: z.enum(Object.keys(NICHE_CONFIGS) as [string, ...string[]]).nullable(),
  suggestedCatalogItems: z.array(z.object({ name: z.string(), estimatedPriceHint: z.string().nullable() })),
});

export type OnboardingPrefill = z.infer<typeof PrefillSchema> & {
  logoUrl: string | null;
  socialLinks: string[];
};

const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com"];

// Plain regex over the raw HTML, not an AI call — a URL either is or isn't
// in the markup, so there's nothing for a model to add here, and this
// stays reliable even when ANTHROPIC_API_KEY isn't configured.
function extractLogoAndSocialLinks(html: string, pageUrl: string): { logoUrl: string | null; socialLinks: string[] } {
  let logoUrl: string | null = null;
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const iconLink = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  const raw = ogImage?.[1] ?? iconLink?.[1] ?? null;
  // Some sites set an empty `data:,` favicon specifically to suppress the
  // browser's default favicon request — that's a real, common pattern
  // (example.com does this), not a logo worth fetching.
  if (raw && !raw.startsWith("data:")) {
    try {
      logoUrl = new URL(raw, pageUrl).toString();
    } catch {
      logoUrl = null;
    }
  }

  const socialLinks = new Set<string>();
  const hrefMatches = html.matchAll(/href=["']([^"']+)["']/gi);
  for (const match of hrefMatches) {
    const href = match[1];
    if (SOCIAL_HOSTS.some((host) => href.includes(host))) {
      socialLinks.add(href);
    }
    if (socialLinks.size >= 6) break;
  }

  return { logoUrl, socialLinks: [...socialLinks] };
}

export async function prefillFromUrl(url: string): Promise<OnboardingPrefill | null> {
  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    html = await res.text();
  } catch {
    return null;
  }

  const { logoUrl, socialLinks } = extractLogoAndSocialLinks(html, url);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { businessName: null, suggestedNiche: null, suggestedCatalogItems: [], logoUrl, socialLinks };
  }

  // Crude tag strip — good enough signal for the model, no need for a
  // full HTML parser dependency for this.
  const pageText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").slice(0, 8000);

  try {
    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-5"),
      schema: PrefillSchema,
      prompt:
        `Here is the text content of a business's website. Extract: their business name, ` +
        `which of these business categories fits best (${Object.keys(NICHE_CONFIGS).join(", ")}), ` +
        `and up to 5 products/services they likely sell (with a rough price hint if mentioned, else null).\n\n` +
        `${pageText}`,
    });
    return { ...object, logoUrl, socialLinks };
  } catch (err) {
    console.error("[onboarding:prefill] extraction failed:", err);
    return { businessName: null, suggestedNiche: null, suggestedCatalogItems: [], logoUrl, socialLinks };
  }
}
