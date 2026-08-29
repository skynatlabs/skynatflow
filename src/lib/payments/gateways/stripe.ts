// Stripe Checkout Session, via a raw fetch call rather than the Stripe SDK
// — one endpoint, form-encoded body, no new dependency for what's still a
// graceful-degradation stub for most tenants. Without a secret key this
// returns a stub success so the portal flow works before Stripe is
// actually connected.

import type { PaymentGatewayClient } from "../types";

export function createStripeGateway(secretKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, currency, reference, description, returnUrl, cancelUrl }) {
      if (!secretKey) {
        console.warn(`[payments:stripe:stub] would create checkout for ${amountCents} cents`);
        return { ok: true, redirectUrl: returnUrl, reference: `stub_${Date.now()}` };
      }

      const body = new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": description,
        "line_items[0][quantity]": "1",
        success_url: returnUrl,
        cancel_url: cancelUrl,
        client_reference_id: reference,
      });

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      if (!res.ok) return { ok: false, error: `Stripe checkout failed: ${res.status}` };
      const data = await res.json();
      return { ok: true, redirectUrl: data.url, reference: data.id };
    },
  };
}
