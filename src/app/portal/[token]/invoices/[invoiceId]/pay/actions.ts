"use server";

import { redirect } from "next/navigation";
import { PaymentGatewayProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { PAYMENT_GATEWAYS } from "@/lib/payments/registry";

export async function startPortalCheckoutAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const provider = String(formData.get("provider") ?? "") as PaymentGatewayProvider;

  const party = await findPartyByPortalToken(token);
  if (!party) throw new Error("Invalid portal link");

  const invoice = await prisma.transaction.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.partyId !== party.id || invoice.type !== "INVOICE") {
    throw new Error("Invoice not found");
  }

  const gateway = await prisma.paymentGateway.findFirst({
    where: { tenantId: invoice.tenantId, provider, isActive: true },
  });
  if (!gateway) throw new Error("This payment method isn't available.");

  const checkout = await prisma.paymentCheckout.create({
    data: {
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      provider,
      amountCents: invoice.amountCents,
    },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const returnUrl = `${base}/portal/${token}/invoices/${invoiceId}/pay/confirm?checkoutId=${checkout.id}`;
  const cancelUrl = `${base}/portal/${token}/invoices/${invoiceId}`;

  const client = PAYMENT_GATEWAYS[provider].create(gateway.publicKey, gateway.secretKey);
  const result = await client.createCheckout({
    amountCents: invoice.amountCents,
    currency: gateway.region === "USA" ? "USD" : "ZAR",
    reference: checkout.id,
    description: `Invoice payment — ${invoice.id}`,
    returnUrl,
    cancelUrl,
    customerEmail: party.email ?? undefined,
  });

  if (!result.ok || !result.redirectUrl) {
    await prisma.paymentCheckout.update({
      where: { id: checkout.id },
      data: { status: "FAILED" },
    });
    throw new Error(result.error ?? "Could not start checkout");
  }

  await prisma.paymentCheckout.update({
    where: { id: checkout.id },
    data: { reference: result.reference },
  });

  redirect(result.redirectUrl);
}
