// Yoco Online Checkout API — hosted redirect flow. Without a secret key
// this returns a stub success reference so the portal "Pay by card"
// button works end-to-end in dev/demo before a real Yoco account exists.

import type { PaymentGatewayClient } from "../types";

export function createYocoGateway(secretKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, reference, description, returnUrl, cancelUrl }) {
      if (!secretKey) {
        console.warn(`[payments:yoco:stub] would create checkout for ${amountCents} cents`);
        return { ok: true, redirectUrl: returnUrl, reference: `stub_${Date.now()}` };
      }

      const res = await fetch("https://payments.yoco.com/api/checkouts", {
        method: "POST",
        headers: {
          "X-Auth-Secret-Key": secretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountCents,
          currency: "ZAR",
          successUrl: returnUrl,
          cancelUrl,
          failureUrl: cancelUrl,
          metadata: { reference, description },
        }),
      });

      if (!res.ok) return { ok: false, error: `Yoco checkout failed: ${res.status}` };
      const data = await res.json();
      return { ok: true, redirectUrl: data.redirectUrl, reference: data.id };
    },
  };
}
