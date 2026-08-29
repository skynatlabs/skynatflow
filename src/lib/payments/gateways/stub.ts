import type { PaymentGatewayClient } from "../types";

// Same graceful-degradation pattern used everywhere else in this app
// (WhatsApp, R2, Anthropic, POS providers): a gateway that isn't wired up
// yet is listed in settings as "coming soon" rather than hidden, and
// clearly refuses instead of pretending to work.
export function createStubGateway(label: string): PaymentGatewayClient {
  return {
    async createCheckout(params) {
      console.warn(`[payments:${label}:not-yet-implemented] would charge ${params.amountCents} cents`);
      return { ok: false, error: `${label} isn't wired up yet — coming soon.` };
    },
  };
}
