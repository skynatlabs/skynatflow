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

export type OnboardingPrefill = z.infer<typeof PrefillSchema>;

export async function prefillFromUrl(url: string): Promise<OnboardingPrefill | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  let pageText: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    // Crude tag strip — good enough signal for the model, no need for a
    // full HTML parser dependency for this.
    pageText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").slice(0, 8000);
  } catch {
    return null;
  }

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
    return object;
  } catch (err) {
    console.error("[onboarding:prefill] extraction failed:", err);
    return null;
  }
}
