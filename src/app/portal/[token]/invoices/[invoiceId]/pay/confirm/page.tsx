// Landing point after a customer completes checkout on the gateway's
// hosted page. This page is DISPLAY ONLY — it never writes to the ledger.
// A customer reaching this URL proves only that their browser was
// redirected here, which anyone can do by typing the URL. The payment is
// recorded exclusively by the provider's signed server-to-server callback
// at /api/webhooks/payments/[provider].
//
// That callback usually lands before the customer's browser does, but not
// always, so this page reads whatever state the webhook has already written
// and tells the customer the truth either way.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { findPartyByPortalToken } from "@/lib/core/parties";

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

  if (checkout.status === "CONFIRMED") {
    redirect(`/portal/${token}/invoices/${invoiceId}?paid=1`);
  }

  // Still PENDING or FAILED: say so plainly rather than implying success.
  const failed = checkout.status === "FAILED";
  return (
    <div className="kb-shell min-h-screen p-8" data-theme="light">
      <main className="mx-auto max-w-md">
        <div className="kb-card p-6 text-center">
          <p className="text-lg font-semibold text-[var(--kb-text)]">
            {failed ? "That payment didn't go through" : "Confirming your payment…"}
          </p>
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
            {failed
              ? checkout.failureReason ??
                "Your bank or card provider declined it. Nothing has been charged — you can try again."
              : "We're waiting for your bank to confirm. This usually takes a few seconds; " +
                "the invoice updates on its own once it clears, and you'll get a receipt."}
          </p>
          <Link
            href={`/portal/${token}/invoices/${invoiceId}`}
            className="kb-pill kb-pill-primary mt-5 inline-block text-xs"
          >
            Back to the invoice
          </Link>
        </div>
      </main>
    </div>
  );
}
