// Landing point after a customer completes checkout on the gateway's
// hosted page. Treating the redirect back here as confirmation is the
// honest stub-first approach (matches this app's graceful-degradation
// pattern elsewhere) but it is NOT how a real gateway integration should
// stay long-term: a customer could hit this URL without actually paying.
// Before taking real money through any of these gateways, replace this
// with each provider's signed webhook (Stripe's checkout.session.completed,
// PayFast's ITN, Paystack's charge.success, etc.) calling recordPayment
// from there instead of from this page.

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { recordPayment } from "@/lib/core/money";

export default async function PortalCheckoutConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; invoiceId: string }>;
  searchParams: Promise<{ checkoutId?: string }>;
}) {
  const { token, invoiceId } = await params;
  const { checkoutId } = await searchParams;
  const party = await findPartyByPortalToken(token);
  if (!party || !checkoutId) notFound();

  const invoice = await prisma.transaction.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.partyId !== party.id || invoice.type !== "INVOICE") notFound();

  const checkout = await prisma.paymentCheckout.findUnique({ where: { id: checkoutId } });
  if (!checkout || checkout.invoiceId !== invoiceId) notFound();

  if (checkout.status === "PENDING") {
    await recordPayment({ invoiceId: checkout.invoiceId, amountCents: checkout.amountCents });
    await prisma.paymentCheckout.update({
      where: { id: checkout.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  }

  redirect(`/portal/${token}/invoices/${invoiceId}?paid=1`);
}
