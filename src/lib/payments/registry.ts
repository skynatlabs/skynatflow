// Registry of every online payment gateway a tenant can offer customers on
// the portal, keyed by region — adding a new market/provider is one new
// file plus one new entry here, same pattern as src/lib/pos/providers.
// Only Yoco, Stripe, PayFast, and Paystack have real API calls today; the
// rest are named/region-tagged so the settings UI can list them as
// "coming soon" without a schema or code-shape change once they're wired up.

import { PaymentGatewayProvider } from "@prisma/client";
import type { PaymentGatewayClient } from "./types";
import { createYocoGateway } from "./gateways/yoco";
import { createStripeGateway } from "./gateways/stripe";
import { createPaystackGateway } from "./gateways/paystack";
import { createPayFastGateway } from "./gateways/payfast";
import { createStubGateway } from "./gateways/stub";

export interface PaymentGatewayMeta {
  label: string;
  region: "RSA" | "USA";
  // publicKey isn't needed by every gateway (e.g. Yoco/Paystack only need
  // a secret key) but the settings form always shows both fields so a
  // gateway that later needs one (Stripe's publishable key, PayFast's
  // merchant id) doesn't need a form redesign.
  create: (publicKey: string | null, secretKey: string | null) => PaymentGatewayClient;
}

export const PAYMENT_GATEWAYS: Record<PaymentGatewayProvider, PaymentGatewayMeta> = {
  // --- RSA ---
  YOCO: { label: "Yoco", region: "RSA", create: (_pub, secret) => createYocoGateway(secret) },
  PAYFAST: { label: "PayFast", region: "RSA", create: (pub, secret) => createPayFastGateway(pub, secret) },
  PEACH_PAYMENTS: { label: "Peach Payments", region: "RSA", create: () => createStubGateway("Peach Payments") },
  OZOW: { label: "Ozow", region: "RSA", create: () => createStubGateway("Ozow") },
  IKHOKHA: { label: "iKhokha", region: "RSA", create: () => createStubGateway("iKhokha") },
  SNAPSCAN: { label: "SnapScan", region: "RSA", create: () => createStubGateway("SnapScan") },
  PAYSTACK: { label: "Paystack", region: "RSA", create: (_pub, secret) => createPaystackGateway(secret) },
  NETCASH: { label: "Netcash", region: "RSA", create: () => createStubGateway("Netcash") },
  // --- USA ---
  STRIPE: { label: "Stripe", region: "USA", create: (_pub, secret) => createStripeGateway(secret) },
  PAYPAL: { label: "PayPal", region: "USA", create: () => createStubGateway("PayPal") },
  SQUARE: { label: "Square", region: "USA", create: () => createStubGateway("Square") },
  AUTHORIZE_NET: { label: "Authorize.Net", region: "USA", create: () => createStubGateway("Authorize.Net") },
  BRAINTREE: { label: "Braintree", region: "USA", create: () => createStubGateway("Braintree") },
};

export function gatewaysForRegion(region: "RSA" | "USA") {
  return Object.entries(PAYMENT_GATEWAYS)
    .filter(([, meta]) => meta.region === region)
    .map(([provider, meta]) => ({ provider: provider as PaymentGatewayProvider, ...meta }));
}
