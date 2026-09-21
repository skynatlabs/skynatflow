// Charging for flow itself.
//
// The properties worth asserting are the ones that decide whether this is
// safe to leave switched on: that it degrades clearly when no gateway is
// configured, and that a caller can never choose its own price.

import { describe, it, expect, afterEach } from "vitest";
import { handleBillingWebhook, platformGatewayStatus, startSubscriptionPayment } from "../../src/lib/billing/collect";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env.PLATFORM_GATEWAY = ORIGINAL.PLATFORM_GATEWAY;
  process.env.PLATFORM_GATEWAY_SECRET_KEY = ORIGINAL.PLATFORM_GATEWAY_SECRET_KEY;
});

describe("when no gateway is configured", () => {
  it("says so plainly rather than throwing", () => {
    delete process.env.PLATFORM_GATEWAY;
    const status = platformGatewayStatus();
    expect(status.configured).toBe(false);
    expect(status.note).toMatch(/no platform payment gateway is set/i);
    // The note has to name the variables, or somebody has to read the source
    // to find out what is missing.
    expect(status.note).toContain("PLATFORM_GATEWAY_SECRET_KEY");
  });

  it("refuses to start a payment, with the reason", async () => {
    delete process.env.PLATFORM_GATEWAY;
    const result = await startSubscriptionPayment({ tenantId: "t_none", baseUrl: "https://example.test" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/gateway/i);
  });

  it("ignores a webhook instead of trusting it", async () => {
    // A public endpoint with no configured gateway must not be a way to
    // switch a subscription on.
    delete process.env.PLATFORM_GATEWAY;
    const result = await handleBillingWebhook({ rawBody: '{"paid":true}', headers: {} });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("not_configured");
  });
});

describe("when a gateway is named but has no key", () => {
  it("is still not configured, and says which half is missing", () => {
    process.env.PLATFORM_GATEWAY = "STRIPE";
    delete process.env.PLATFORM_GATEWAY_SECRET_KEY;
    const status = platformGatewayStatus();
    expect(status.configured).toBe(false);
    expect(status.provider).toBe("STRIPE");
    expect(status.note).toMatch(/PLATFORM_GATEWAY_SECRET_KEY is not set/);
  });

  it("rejects a provider name that is not one we have", () => {
    process.env.PLATFORM_GATEWAY = "NOT_A_GATEWAY";
    process.env.PLATFORM_GATEWAY_SECRET_KEY = "sk_test";
    expect(platformGatewayStatus().configured).toBe(false);
  });
});
