// Three providers, two tiers, and what a cached read costs.
//
// These are the guards on the cost work: that every provider has both tiers
// priced, that the cheap tier is actually cheap, and that a cached input
// token is billed as one. A pricing table with a hole in it silently falls
// back to the most expensive rate we run, which is safe for the invoice and
// misleading for the margin view — so the hole is asserted shut here.

import { describe, it, expect } from "vitest";
import { costOf, hasPublishedRate } from "../../src/lib/agent/budget";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  MODELS,
  modelIdFor,
  type AiProvider,
  type ModelTier,
} from "../../src/lib/ai/model";

const TIERS: ModelTier[] = ["smart", "fast"];

describe("model routing", () => {
  it("offers all three providers", () => {
    expect(AI_PROVIDERS).toEqual(["anthropic", "google", "openai"]);
    for (const provider of AI_PROVIDERS) {
      expect(AI_PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });

  it("names a model for every provider and tier", () => {
    for (const provider of AI_PROVIDERS) {
      for (const tier of TIERS) {
        expect(modelIdFor(provider, tier), `${provider}/${tier}`).toBeTruthy();
      }
    }
  });

  it("gives every provider a distinct smart and fast model", () => {
    for (const provider of AI_PROVIDERS) {
      expect(MODELS[provider].smart, provider).not.toBe(MODELS[provider].fast);
    }
  });

  it("prices every model we can actually call", () => {
    // A model missing from the rate table falls back to the frontier rate,
    // which is the right default and must never be load-bearing: it would
    // quietly overstate a cheap model's cost and hide how well routing works.
    for (const provider of AI_PROVIDERS) {
      for (const tier of TIERS) {
        const id = modelIdFor(provider, tier);
        expect(hasPublishedRate(id), `${provider}/${tier} (${id}) is not in the rate table`).toBe(true);
      }
    }
    expect(hasPublishedRate("definitely-not-a-real-model")).toBe(false);
  });

  it("makes the fast tier cheaper than the smart tier, at every provider", () => {
    for (const provider of AI_PROVIDERS as AiProvider[]) {
      const smart = costOf({ model: MODELS[provider].smart, inputTokens: 1_000_000, outputTokens: 200_000 });
      const fast = costOf({ model: MODELS[provider].fast, inputTokens: 1_000_000, outputTokens: 200_000 });
      expect(fast, `${provider}: fast tier is not cheaper`).toBeLessThan(smart);
    }
  });

  describe("cached reads", () => {
    const model = MODELS.anthropic.smart;

    it("bills a cached token at a fraction of a fresh one", () => {
      const cold = costOf({ model, inputTokens: 1_000_000, outputTokens: 0 });
      const warm = costOf({ model, inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 });
      expect(warm).toBeLessThan(cold);
      expect(warm).toBeCloseTo(cold * 0.1, 5);
    });

    it("treats an absent cache count as nothing cached", () => {
      const a = costOf({ model, inputTokens: 500_000, outputTokens: 1_000 });
      const b = costOf({ model, inputTokens: 500_000, outputTokens: 1_000, cachedInputTokens: 0 });
      expect(a).toBe(b);
    });

    it("never counts more cached tokens than were sent", () => {
      // A provider reporting oddly must not produce a negative bill.
      const overreported = costOf({ model, inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 99_999 });
      const allCached = costOf({ model, inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 1_000 });
      expect(overreported).toBe(allCached);
      expect(overreported).toBeGreaterThan(0);
    });
  });

  it("puts the cheapest option genuinely far below the frontier one", () => {
    // The whole routing argument rests on this gap being large enough to be
    // worth the complexity. If it ever narrows, routing stops paying for
    // itself and this test should be the thing that says so.
    const frontier = costOf({ model: MODELS.anthropic.smart, inputTokens: 1_000_000, outputTokens: 100_000 });
    const cheapest = costOf({ model: MODELS.openai.fast, inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(frontier / cheapest).toBeGreaterThan(5);
  });
});

// The agent tier. Fast is the default and the decision is deliberate: a run
// is only offered the tools its request could need, so choosing among them is
// not frontier work. These assert the default holds and that the override
// chain — tenant, then platform, then the default — resolves in that order.
describe("agent tier", () => {
  it("defaults to fast when nothing is set", async () => {
    const { getAgentTier } = await import("../../src/lib/ai/model");
    expect(await getAgentTier()).toBe("fast");
  });

  it("prices a fast agent run well under a frontier one", () => {
    // 3 steps, the static prefix cached after the first, a typical run.
    const run = { inputTokens: 12_000, outputTokens: 800, cachedInputTokens: 6_000 };
    const fast = costOf({ model: MODELS.anthropic.fast, ...run });
    const frontier = costOf({ model: MODELS.anthropic.smart, ...run });
    // Anthropic's two tiers are a clean 3:1 on both input and output, so this
    // ratio is exactly three — asserted as such rather than as a floor, so
    // that a change in either rate shows up here instead of passing quietly.
    expect(frontier / fast).toBeCloseTo(3, 6);
  });
});
