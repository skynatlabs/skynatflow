// PayFast — the most widely used RSA gateway for SME invoicing. Unlike
// Stripe/Yoco/Paystack it has no "create checkout, get a URL back" API
// call: you build a signed redirect URL yourself and send the customer
// straight there. publicKey = merchant_id, secretKey = merchant_key (a
// passphrase can be added later for extra signature security; omitted
// here to keep setup to the two values PayFast calls out as required).

import { createHash } from "crypto";
import type { PaymentGatewayClient } from "../types";

export function createPayFastGateway(merchantId: string | null, merchantKey: string | null): PaymentGatewayClient {
  return {
    async createCheckout({ amountCents, reference, description, returnUrl, cancelUrl }) {
      if (!merchantId || !merchantKey) {
        console.warn(`[payments:payfast:stub] would create checkout for ${amountCents} cents`);
        return { ok: true, redirectUrl: returnUrl, reference: `stub_${Date.now()}` };
      }

      const fields: Record<string, string> = {
        merchant_id: merchantId,
        merchant_key: merchantKey,
        return_url: returnUrl,
        cancel_url: cancelUrl,
        notify_url: returnUrl,
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
  };
}
