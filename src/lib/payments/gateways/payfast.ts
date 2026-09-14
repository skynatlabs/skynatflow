// PayFast — the most widely used RSA gateway for SME invoicing. Unlike
// Stripe/Yoco/Paystack it has no "create checkout, get a URL back" API
// call: you build a signed redirect URL yourself and send the customer
// straight there. publicKey = merchant_id, secretKey = merchant_key (a
// passphrase can be added later for extra signature security; omitted
// here to keep setup to the two values PayFast calls out as required).

import { createHash } from "crypto";
import type { PaymentGatewayClient, WebhookVerdict } from "../types";

export function createPayFastGateway(merchantId: string | null, merchantKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, reference, description, returnUrl, cancelUrl, notifyUrl }) {
      if (!merchantId || !merchantKey) {
        console.warn(`[payments:payfast:stub] would create checkout for ${amountCents} cents`);
        return { ok: true, redirectUrl: returnUrl, reference: `stub_${Date.now()}` };
      }

      const fields: Record<string, string> = {
        merchant_id: merchantId,
        merchant_key: merchantKey,
        return_url: returnUrl,
        cancel_url: cancelUrl,
        notify_url: notifyUrl,
        m_payment_id: reference,
        amount: (amountCents / 100).toFixed(2),
        item_name: description.slice(0, 100),
      };

      const signatureString = Object.entries(fields)
        .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`)
        .join("&");
      const signature = createHash("md5").update(signatureString).digest("hex");

      const params = new URLSearchParams({ ...fields, signature });
      return {
        ok: true,
        redirectUrl: `https://www.payfast.co.za/eng/process?${params.toString()}`,
        reference,
      };
    },

    // PayFast's ITN is form-encoded, not JSON, and is verified in two steps
    // PayFast requires together: recompute the MD5 signature over the posted
    // fields, then post the whole payload back to PayFast and require an
    // explicit VALID. The signature alone is not sufficient — anyone who
    // learned the passphrase could forge one — which is why the postback is
    // not optional here.
    async verifyWebhook({ rawBody }, { webhookSecret }): Promise<WebhookVerdict> {
      const posted = Object.fromEntries(new URLSearchParams(rawBody));
      const provided = posted.signature;
      if (!provided) {
        return { ok: false, outcome: "ignored", error: "ITN carried no signature." };
      }

      // Signature is computed over every field except `signature` itself,
      // in the order PayFast posted them, with the passphrase appended.
      const pairs = [...new URLSearchParams(rawBody)].filter(([k]) => k !== "signature");
      let signatureString = pairs
        .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`)
        .join("&");
      if (webhookSecret) {
        signatureString += `&passphrase=${encodeURIComponent(webhookSecret.trim()).replace(/%20/g, "+")}`;
      }
      const expected = createHash("md5").update(signatureString).digest("hex");
      if (expected !== provided) {
        return { ok: false, outcome: "ignored", error: "ITN signature mismatch." };
      }

      const validateHost =
        posted.test_mode === "1" ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
      let confirmation = "";
      try {
        const res = await fetch(`${validateHost}/eng/query/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: rawBody,
        });
        confirmation = (await res.text()).trim();
      } catch (err) {
        return {
          ok: false,
          outcome: "ignored",
          error: `Could not reach PayFast to validate: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }
      if (!confirmation.startsWith("VALID")) {
        return { ok: false, outcome: "ignored", error: "PayFast did not confirm this ITN." };
      }

      const status = posted.payment_status;
      const amountCents = posted.amount_gross
        ? Math.round(Number(posted.amount_gross) * 100)
        : undefined;

      return {
        ok: true,
        outcome: status === "COMPLETE" ? "paid" : "failed",
        reference: posted.m_payment_id,
        eventId: posted.pf_payment_id ? `payfast:${posted.pf_payment_id}` : undefined,
        amountCents,
      };
    },
  };
}
