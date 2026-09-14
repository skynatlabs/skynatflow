// Common interface every online payment gateway implements — a checkout
// is a redirect flow (customer leaves the portal, pays on the gateway's
// hosted page, gets redirected back), not a direct card charge. Adding a
// new gateway is one new file here, never a change to the portal page or
// the checkout action.

export interface CheckoutResult {
  ok: boolean;
  redirectUrl?: string;
  reference?: string;
  error?: string;
}


// What a provider's server-to-server callback told us about one checkout.
// `eventId` is the provider's own id for the event and is stored unique, so
// a provider that retries a delivery (all of them do) can never credit the
// same payment twice.
export interface WebhookVerdict {
  ok: boolean;
  // "paid" is the only outcome that writes to the ledger.
  outcome: "paid" | "failed" | "ignored";
  reference?: string; // our PaymentCheckout.id, echoed back by the gateway
  eventId?: string;
  amountCents?: number;
  error?: string;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Record<string, string>;
  // Source IP, used by PayFast whose ITN is validated by server postback
  // rather than a signature alone.
  sourceIp?: string;
}

export interface PaymentGatewayClient {
  createCheckout(params: {
    amountCents: number;
    currency: string;
    reference: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    notifyUrl: string;
    customerEmail?: string;
  }): Promise<CheckoutResult>;

  // Verifies a callback actually came from the provider and says what it
  // means. A gateway with no webhook support returns outcome "ignored".
  verifyWebhook(req: WebhookRequest, secrets: {
    webhookSecret: string | null;
    publicKey: string | null;
    secretKey: string | null;
  }): Promise<WebhookVerdict>;
}