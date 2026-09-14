// Stripe Checkout Session, via a raw fetch call rather than the Stripe SDK
// — one endpoint, form-encoded body, no new dependency for what's still a
// graceful-degradation stub for most tenants. Without a secret key this
// returns a stub success so the portal flow works before Stripe is
// actually connected.

import { createHmac, timingSafeEqual } from "crypto";
import type { PaymentGatewayClient, WebhookVerdict } from "../types";

// Stripe signs with `t=<unix>,v1=<hex hmac of "t.body">`. Anything older
// than this is rejected so a captured callback can't be replayed later.
const TOLERANCE_SECONDS = 300;

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
        // Echoed back on the webhook event, so the callback can be tied to
        // our PaymentCheckout row without trusting anything in the URL.
        "metadata[checkoutId]": reference,
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

    async verifyWebhook({ rawBody, headers }, { webhookSecret }): Promise<WebhookVerdict> {
      if (!webhookSecret) {
        return { ok: false, outcome: "ignored", error: "No webhook signing secret configured." };
      }

      const header = headers["stripe-signature"];
      if (!header) return { ok: false, outcome: "ignored", error: "Missing stripe-signature header." };

      const parts = Object.fromEntries(
        header.split(",").map((kv) => {
          const i = kv.indexOf("=");
          return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        })
      );
      const timestamp = Number(parts.t);
      const provided = parts.v1;
      if (!timestamp || !provided) {
        return { ok: false, outcome: "ignored", error: "Malformed stripe-signature header." };
      }

      const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
      if (age > TOLERANCE_SECONDS) {
        return { ok: false, outcome: "ignored", error: "Signature timestamp outside tolerance." };
      }

      const expected = createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");
      if (!safeEqualHex(expected, provided)) {
        return { ok: false, outcome: "ignored", error: "Signature mismatch." };
      }

      let event: {
        id?: string;
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { ok: false, outcome: "ignored", error: "Body is not JSON." };
      }

      // Only the completed-checkout event moves money in the ledger. Every
      // other event type Stripe sends to this endpoint is acknowledged and
      // ignored, so the provider doesn't retry it forever.
      if (event.type !== "checkout.session.completed") {
        return { ok: true, outcome: "ignored", eventId: event.id };
      }

      const session = event.data?.object ?? {};
      const metadata = (session.metadata ?? {}) as Record<string, string>;
      const reference = metadata.checkoutId ?? (session.client_reference_id as string | undefined);
      const paid = session.payment_status === "paid";

      return {
        ok: true,
        outcome: paid ? "paid" : "failed",
        reference,
        eventId: event.id,
        amountCents: typeof session.amount_total === "number" ? session.amount_total : undefined,
      };
    },
  };
}

// Constant-time compare that can't throw on a length mismatch, which a
// plain timingSafeEqual does and which would itself leak length info.
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
