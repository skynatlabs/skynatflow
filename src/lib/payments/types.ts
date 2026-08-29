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

export interface PaymentGatewayClient {
  createCheckout(params: {
    amountCents: number;
    currency: string;
    reference: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  }): Promise<CheckoutResult>;
}
