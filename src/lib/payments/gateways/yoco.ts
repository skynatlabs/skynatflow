// Yoco Online Checkout API — hosted redirect flow. Without a secret key
// this returns a stub success reference so the portal "Pay by card"
// button works end-to-end in dev/demo before a real Yoco account exists.

import { createHmac, timingSafeEqual } from "crypto";
import type { PaymentGatewayClient, WebhookVerdict } from "../types";

export function createYocoGateway(secretKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, reference, description, returnUrl, cancelUrl, notifyUrl }) {
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
          // Yoco posts the outcome here; the return URL is only where the
          // customer's browser lands and proves nothing about payment.
          webhookUrl: notifyUrl,
        }),
      });

      if (!res.ok) return { ok: false, error: `Yoco checkout failed: ${res.status}` };
      const data = await res.json();
      return { ok: true, redirectUrl: data.redirectUrl, reference: data.id };
    },

    // Yoco uses the standard webhook (svix) scheme: sign
    // "<id>.<timestamp>.<body>" with the base64 secret after its whsec_
    // prefix, and send it base64 in webhook-signature as "v1,<sig>".
    async verifyWebhook({ rawBody, headers }, { webhookSecret }): Promise<WebhookVerdict> {
      if (!webhookSecret) {
        return { ok: false, outcome: "ignored", error: "No Yoco webhook secret configured." };
      }

      const id = headers["webhook-id"];
      const timestamp = headers["webhook-timestamp"];
      const signatureHeader = headers["webhook-signature"];
      if (!id || !timestamp || !signatureHeader) {
        return { ok: false, outcome: "ignored", error: "Missing webhook-* headers." };
      }

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number(timestamp) || age > 300) {
        return { ok: false, outcome: "ignored", error: "Timestamp outside tolerance." };
      }

      const secretBytes = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
      const expected = createHmac("sha256", secretBytes)
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest("base64");

      // The header can carry several space-separated versioned signatures.
      const matched = signatureHeader
        .split(" ")
        .map((part) => part.split(",")[1] ?? "")
        .some((candidate) => safeEqualB64(expected, candidate));
      if (!matched) return { ok: false, outcome: "ignored", error: "Signature mismatch." };

      let event: { type?: string; payload?: Record<string, unknown> };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { ok: false, outcome: "ignored", error: "Body is not JSON." };
      }

      const payload = event.payload ?? {};
      const metadata = (payload.metadata ?? {}) as Record<string, string>;
      if (event.type !== "payment.succeeded") {
        return { ok: true, outcome: "ignored", eventId: id };
      }

      return {
        ok: true,
        outcome: "paid",
        reference: metadata.reference,
        eventId: id,
        amountCents: typeof payload.amount === "number" ? payload.amount : undefined,
      };
    },
  };
}

function safeEqualB64(a: string, b: string): boolean {
  const ab = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
