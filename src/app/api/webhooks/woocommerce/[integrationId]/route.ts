// WooCommerce order.created/order.updated webhook target. The URL itself
// (containing the integration id) plus the signed body together
// authenticate the request — WooCommerce has no other auth on webhooks.
// Must read the RAW body before parsing JSON, since the signature is
// computed over the exact bytes WooCommerce sent.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { verifyWooWebhookSignature, type WooOrder } from "@/lib/ecommerce/woocommerce";
import { processWooOrder } from "@/lib/ecommerce/sync";

export async function POST(req: NextRequest, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  const integration = await prisma.ecommerceIntegration.findUnique({ where: { id: integrationId } });
  if (!integration || !integration.isActive) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rawBody = await req.text();

  // WooCommerce sends a harmless "webhook enabled" ping with an empty
  // body when a webhook is first created — accept it without trying to
  // verify a signature over nothing.
  if (!rawBody.trim()) return NextResponse.json({ ok: true });

  if (integration.webhookSecretEnc) {
    const signature = req.headers.get("x-wc-webhook-signature");
    const secret = decryptSecret(integration.webhookSecretEnc);
    if (!verifyWooWebhookSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let order: WooOrder;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  await processWooOrder(integrationId, order);
  return NextResponse.json({ ok: true });
}
