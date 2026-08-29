// Paystack Initialize Transaction — widely used across Africa (Nigeria,
// Ghana, and increasingly RSA merchants selling cross-border). Amount is
// in the currency's smallest unit already, matching amountCents.

import type { PaymentGatewayClient } from "../types";

export function createPaystackGateway(secretKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, currency, reference, returnUrl, customerEmail }) {
      if (!secretKey) {
        console.warn(`[payments:paystack:stub] would create checkout for ${amountCents} cents`);
        return { ok: true, redirectUrl: returnUrl, reference: `stub_${Date.now()}` };
      }

      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountCents,
          currency,
          email: customerEmail || `${reference}@no-email.flow.invalid`,
          reference,
          callback_url: returnUrl,
        }),
      });

      if (!res.ok) return { ok: false, error: `Paystack checkout failed: ${res.status}` };
      const data = await res.json();
      if (!data.status) return { ok: false, error: data.message ?? "Paystack checkout failed" };
      return { ok: true, redirectUrl: data.data.authorization_url, reference: data.data.reference };
    },
  };
}
