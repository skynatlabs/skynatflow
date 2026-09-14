// Paystack — initialise a transaction, get back an authorization_url to
// redirect the customer to. Amounts are in the currency's minor unit
// (kobo/cents), which matches how everything is stored here already.

import { createHmac, timingSafeEqual } from "crypto";
import type { PaymentGatewayClient, WebhookVerdict } from "../types";

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
          // Paystack requires an email; a placeholder keeps checkout usable
          // for a walk-in customer with nothing on file.
          email: customerEmail ?? "customer@example.com",
          reference,
          callback_url: returnUrl,
        }),
      });

      if (!res.ok) return { ok: false, error: `Paystack checkout failed: ${res.status}` };
      const data = await res.json();
      if (!data.status) return { ok: false, error: data.message ?? "Paystack rejected the request" };
      return { ok: true, redirectUrl: data.data.authorization_url, reference: data.data.reference };
    },

    async verifyWebhook({ rawBody, headers }, { webhookSecret, secretKey: key }): Promise<WebhookVerdict> {
      // Paystack signs with the account's own secret key, so fall back to it
      // when no separate webhook secret was entered.
      const signingKey = webhookSecret || key;
      if (!signingKey) {
        return { ok: false, outcome: "ignored", error: "No Paystack secret configured." };
      }

      const provided = headers["x-paystack-signature"];
      if (!provided) {
        return { ok: false, outcome: "ignored", error: "Missing x-paystack-signature header." };
      }

      const expected = createHmac("sha512", signingKey).update(rawBody).digest("hex");
      if (!safeEqualHex(expected, provided)) {
        return { ok: false, outcome: "ignored", error: "Signature mismatch." };
      }

      let event: { event?: string; data?: Record<string, unknown> };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { ok: false, outcome: "ignored", error: "Body is not JSON." };
      }

      const data = event.data ?? {};
      const reference = data.reference as string | undefined;
      // Paystack has no event id header; the reference plus event name is
      // unique enough to dedupe retries of the same charge.
      const eventId = reference ? `paystack:${event.event}:${reference}` : undefined;

      if (event.event !== "charge.success") {
        return { ok: true, outcome: "ignored", eventId };
      }

      return {
        ok: true,
        outcome: data.status === "success" ? "paid" : "failed",
        reference,
        eventId,
        amountCents: typeof data.amount === "number" ? data.amount : undefined,
      };
    },
  };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
