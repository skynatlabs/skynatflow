// The ONLY place in the app allowed to turn a card payment into a ledger
// row. Previously the portal's checkout-confirm page did it, which meant a
// customer who never paid could mark an invoice paid just by loading the
// return URL. That page is now display-only; money moves here, and only
// after the provider's own signed callback verifies.
//
// Flow: provider POSTs -> look up the checkout by the reference we gave the
// provider -> load that tenant's gateway credentials -> ask the gateway
// implementation to verify the signature -> claim the checkout atomically
// -> record the payment.

import { NextRequest, NextResponse } from "next/server";
import { PaymentGatewayProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitEvent } from "@/lib/agent/events";
import { PAYMENT_GATEWAYS } from "@/lib/payments/registry";
import { recordPayment } from "@/lib/core/money";
import { maybeSendReviewRequest } from "@/lib/core/reviews";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerParam } = await params;
  const provider = providerParam.toUpperCase() as PaymentGatewayProvider;

  if (!(provider in PAYMENT_GATEWAYS)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  // Must be read as raw text, not parsed: every signature scheme here is
  // computed over the exact bytes sent, so re-serialising would break it.
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // The reference is our PaymentCheckout id. Pull it out before verifying so
  // we know which tenant's signing secret to verify against — a signature is
  // only meaningful relative to a specific account's key.
  const reference = extractReference(rawBody, headers["content-type"] ?? "");
  if (!reference) {
    return NextResponse.json({ error: "No reference on callback" }, { status: 400 });
  }

  const checkout = await prisma.paymentCheckout.findFirst({
    where: { OR: [{ id: reference }, { reference }] },
  });
  if (!checkout) {
    // 200, not 404: an unknown reference is not something the provider can
    // fix by retrying, and every provider retries on non-2xx indefinitely.
    console.warn(`[payments:webhook:${provider}] no checkout for reference ${reference}`);
    return NextResponse.json({ received: true, note: "unknown reference" });
  }

  const gateway = await prisma.paymentGateway.findFirst({
    where: { tenantId: checkout.tenantId, provider },
  });
  if (!gateway) {
    return NextResponse.json({ received: true, note: "gateway not configured" });
  }

  const client = PAYMENT_GATEWAYS[provider].create(gateway.publicKey, gateway.secretKey);
  const verdict = await client.verifyWebhook(
    { rawBody, headers, sourceIp: request.headers.get("x-forwarded-for") ?? undefined },
    {
      webhookSecret: gateway.webhookSecret,
      publicKey: gateway.publicKey,
      secretKey: gateway.secretKey,
    }
  );

  if (!verdict.ok) {
    // A signature that doesn't verify is either a misconfiguration or an
    // attempt to forge a payment. 400 so the provider surfaces it in their
    // dashboard, and never anywhere near recordPayment.
    console.error(`[payments:webhook:${provider}] rejected: ${verdict.error}`);
    return NextResponse.json({ error: verdict.error ?? "Verification failed" }, { status: 400 });
  }

  if (verdict.outcome === "ignored") {
    return NextResponse.json({ received: true, note: "event ignored" });
  }

  if (verdict.outcome === "failed") {
    const marked = await prisma.paymentCheckout.updateMany({
      where: { id: checkout.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: "Gateway reported the payment did not succeed." },
    });
    // Only the request that actually made the transition raises it. Providers
    // retry failure callbacks too, and a customer whose card bounced once
    // should not generate five alerts.
    if (marked.count === 1) {
      await emitEvent({
        tenantId: checkout.tenantId,
        type: "payment.failed",
        subjectType: "Transaction",
        subjectId: checkout.invoiceId,
        payload: { amountCents: checkout.amountCents, provider, reason: "declined" },
      });
    }
    return NextResponse.json({ received: true });
  }

  // Guard against the provider reporting a different amount than the one we
  // asked for — a short payment must not silently settle the invoice.
  if (verdict.amountCents !== undefined && verdict.amountCents !== checkout.amountCents) {
    console.error(
      `[payments:webhook:${provider}] amount mismatch on ${checkout.id}: ` +
        `expected ${checkout.amountCents}, got ${verdict.amountCents}`
    );
    const marked = await prisma.paymentCheckout.updateMany({
      where: { id: checkout.id, status: "PENDING" },
      data: {
        status: "FAILED",
        failureReason: `Amount mismatch: expected ${checkout.amountCents}, gateway reported ${verdict.amountCents}.`,
      },
    });
    if (marked.count === 1) {
      // A short payment is worse than a declined one: the customer believes
      // they have paid. The owner needs to hear about this one.
      await emitEvent({
        tenantId: checkout.tenantId,
        type: "payment.failed",
        subjectType: "Transaction",
        subjectId: checkout.invoiceId,
        payload: {
          amountCents: checkout.amountCents,
          reportedCents: verdict.amountCents,
          provider,
          reason: "amount mismatch",
        },
      });
    }
    return NextResponse.json({ received: true, note: "amount mismatch" });
  }

  // Atomic claim. Providers retry deliveries, and two retries can land at
  // once; only the request that actually flips PENDING -> CONFIRMED gets to
  // write the payment. webhookEventId is unique as a second line of defence
  // across redeliveries of the same event.
  const claimed = await prisma.paymentCheckout.updateMany({
    where: { id: checkout.id, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      webhookEventId: verdict.eventId ?? `${provider}:${checkout.id}`,
    },
  });

  if (claimed.count !== 1) {
    return NextResponse.json({ received: true, note: "already processed" });
  }

  await recordPayment({ invoiceId: checkout.invoiceId, amountCents: checkout.amountCents });
  // No-op unless this payment just settled the invoice and a review link is
  // configured — same call the manual payment path makes.
  await maybeSendReviewRequest(checkout.invoiceId);

  return NextResponse.json({ received: true });
}

// PayFast posts form-encoded ITNs; everyone else posts JSON. The reference
// is whichever field that provider was told to echo back.
function extractReference(rawBody: string, contentType: string): string | null {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    return form.get("m_payment_id") ?? form.get("reference") ?? null;
  }

  try {
    const body = JSON.parse(rawBody);
    const obj = body?.data?.object ?? body?.data ?? body?.payload ?? {};
    return (
      obj?.metadata?.checkoutId ??
      obj?.metadata?.reference ??
      obj?.client_reference_id ??
      obj?.reference ??
      null
    );
  } catch {
    return null;
  }
}
