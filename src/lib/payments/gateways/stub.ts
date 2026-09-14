import type { PaymentGatewayClient, WebhookVerdict } from "../types";

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

    async verifyWebhook(): Promise<WebhookVerdict> {
      // Never credits a ledger: a provider with no real integration has no
      // signature we can check, so its callbacks are always inert.
      return { ok: false, outcome: "ignored", error: `${label} has no webhook support yet.` };
    },
  };
}
