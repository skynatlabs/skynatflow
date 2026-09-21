// Taking the money for flow itself.
//
// The billing engine works out what a workspace owes. Until this, nothing
// could collect it — the platform could price a subscription and not charge
// for it, which is the difference between a product and a business.
//
// It deliberately reuses the gateway abstraction the app already has for
// tenants charging their own customers (src/lib/payments). One interface,
// one set of webhook-verification code, one place a new provider is added.
// A second payment stack for our own billing would be the same problem
// solved twice, and the one that rots is the one nobody uses daily.
//
// WHAT IS STILL NEEDED FROM A PERSON
//
// A gateway account in this business's name, and its keys in the
// environment. Without them everything here degrades the same way every
// other integration in this codebase does: it reports clearly that it is not
// configured rather than pretending or throwing.

import { PaymentGatewayProvider } from "@prisma/client";
import { PAYMENT_GATEWAYS } from "@/lib/payments/registry";
import type { PaymentGatewayClient } from "@/lib/payments/types";
import { PLATFORM_CURRENCY } from "@/lib/brand";
import { prisma } from "@/lib/db";
import { billFor } from "@/lib/core/billing";

export interface PlatformGatewayStatus {
  configured: boolean;
  provider: PaymentGatewayProvider | null;
  label: string | null;
  /** Said plainly on the admin screen when it is not set up. */
  note: string;
}

function providerFromEnv(): PaymentGatewayProvider | null {
  const raw = (process.env.PLATFORM_GATEWAY ?? "").toUpperCase();
  return raw in PAYMENT_GATEWAYS ? (raw as PaymentGatewayProvider) : null;
}

/** Whether we can charge anybody yet, and what to say if not. */
export function platformGatewayStatus(): PlatformGatewayStatus {
  const provider = providerFromEnv();
  const secret = process.env.PLATFORM_GATEWAY_SECRET_KEY ?? null;

  if (!provider) {
    return {
      configured: false,
      provider: null,
      label: null,
      note:
        "No platform payment gateway is set. Set PLATFORM_GATEWAY to one of " +
        `${Object.keys(PAYMENT_GATEWAYS).join(", ")} along with PLATFORM_GATEWAY_SECRET_KEY, ` +
        "using an account in this business's own name.",
    };
  }
  if (!secret) {
    return {
      configured: false,
      provider,
      label: PAYMENT_GATEWAYS[provider].label,
      note: `${PAYMENT_GATEWAYS[provider].label} is chosen but PLATFORM_GATEWAY_SECRET_KEY is not set.`,
    };
  }
  return {
    configured: true,
    provider,
    label: PAYMENT_GATEWAYS[provider].label,
    note: `Charging through ${PAYMENT_GATEWAYS[provider].label}.`,
  };
}

function platformGateway(): PaymentGatewayClient | null {
  const status = platformGatewayStatus();
  if (!status.configured || !status.provider) return null;
  return PAYMENT_GATEWAYS[status.provider].create(
    process.env.PLATFORM_GATEWAY_PUBLIC_KEY ?? null,
    process.env.PLATFORM_GATEWAY_SECRET_KEY ?? null
  );
}

export interface StartPaymentResult {
  ok: boolean;
  redirectUrl?: string;
  error?: string;
}

/**
 * Begin paying for a workspace's subscription.
 *
 * The amount comes from the billing engine rather than from the caller, so
 * nothing that reaches this function can decide its own price. The reference
 * is the workspace id, which is what the webhook uses to know whose payment
 * arrived — there is exactly one subscription per workspace, so it needs no
 * separate checkout row.
 */
export async function startSubscriptionPayment(params: {
  tenantId: string;
  baseUrl: string;
}): Promise<StartPaymentResult> {
  const gateway = platformGateway();
  if (!gateway) return { ok: false, error: platformGatewayStatus().note };

  const [bill, tenant] = await Promise.all([
    billFor(params.tenantId),
    prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { name: true, businessEmail: true },
    }),
  ]);

  if (bill.totalCents <= 0) {
    return { ok: false, error: "There is nothing to pay on this plan yet." };
  }

  const result = await gateway.createCheckout({
    amountCents: bill.totalCents,
    currency: PLATFORM_CURRENCY,
    reference: params.tenantId,
    description: `flow — ${bill.plan.name}, ${bill.seats.full} seat${bill.seats.full === 1 ? "" : "s"}`,
    returnUrl: `${params.baseUrl}/dashboard/${params.tenantId}/settings/usage?paid=1`,
    cancelUrl: `${params.baseUrl}/dashboard/${params.tenantId}/settings/usage?paid=0`,
    notifyUrl: `${params.baseUrl}/api/webhooks/platform-billing`,
    customerEmail: tenant?.businessEmail ?? undefined,
  });

  return result.ok
    ? { ok: true, redirectUrl: result.redirectUrl }
    : { ok: false, error: result.error ?? "The payment provider would not start a checkout." };
}

/**
 * Verify a callback from the gateway and, if it is a real payment, switch
 * the workspace on.
 *
 * Verification is the gateway's own — the same signature checking the tenant
 * payment webhook already uses. A callback that does not verify changes
 * nothing, which is the only acceptable behaviour for a message that says
 * money arrived.
 */
export async function handleBillingWebhook(req: {
  rawBody: string;
  headers: Record<string, string>;
  sourceIp?: string;
}): Promise<{ ok: boolean; outcome: string; tenantId?: string }> {
  const gateway = platformGateway();
  if (!gateway) return { ok: false, outcome: "not_configured" };

  const verdict = await gateway.verifyWebhook(req, {
    webhookSecret: process.env.PLATFORM_GATEWAY_WEBHOOK_SECRET ?? null,
    publicKey: process.env.PLATFORM_GATEWAY_PUBLIC_KEY ?? null,
    secretKey: process.env.PLATFORM_GATEWAY_SECRET_KEY ?? null,
  });

  if (!verdict.ok || verdict.outcome !== "paid" || !verdict.reference) {
    return { ok: verdict.ok, outcome: verdict.outcome };
  }

  const tenantId = verdict.reference;
  const exists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!exists) return { ok: false, outcome: "unknown_workspace" };

  // activate() is idempotent, which matters: every gateway retries, and a
  // second delivery of the same payment must not do anything different.
  const { activate } = await import("@/lib/core/billing");
  await activate(tenantId);

  return { ok: true, outcome: "paid", tenantId };
}
