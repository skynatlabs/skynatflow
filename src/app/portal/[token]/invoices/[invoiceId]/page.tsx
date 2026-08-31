// Invoice view — the invoice-side counterpart to the quote portal page.
// No signature/acceptance step (that already happened at the quote
// stage); this is just a clean, shareable "here's what you owe" view
// with a PDF download link.

import { notFound } from "next/navigation";
import Link from "next/link";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { PAYMENT_GATEWAYS } from "@/lib/payments/registry";
import { startPortalCheckoutAction } from "./pay/actions";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PortalInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; invoiceId: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token, invoiceId } = await params;
  const { paid } = await searchParams;
  const party = await findPartyByPortalToken(token);
  if (!party) notFound();

  const invoice = await prisma.transaction.findUnique({
    where: { id: invoiceId },
    include: {
      itemLines: { include: { item: true } },
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!invoice || invoice.partyId !== party.id || invoice.type !== "INVOICE") notFound();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });

  const gateways =
    invoice.status === "PAID"
      ? []
      : await prisma.paymentGateway.findMany({ where: { tenantId: invoice.tenantId, isActive: true } });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="kb-card p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[var(--kb-text)]">Invoice</h1>
          <Link
            href={`/portal/${token}/invoices/${invoiceId}/pdf`}
            className="kb-pill kb-pill-primary text-xs"
            target="_blank"
          >
            Download PDF
          </Link>
        </div>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">Status: {invoice.status}</p>
        {invoice.subject && <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{invoice.subject}</p>}
        {invoice.poNumber && <p className="text-xs text-[var(--kb-text-dim)]">PO #: {invoice.poNumber}</p>}
        {invoice.salesPersonMembership && (
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Prepared by {invoice.salesPersonMembership.user.name ?? invoice.salesPersonMembership.user.email}
          </p>
        )}

        <ul className="mt-4 divide-y divide-[var(--kb-panel-border)]">
          {invoice.itemLines.map((l) => (
            <li key={l.id} className="flex items-center justify-between py-2 text-sm">
              <span>{l.quantity}x {l.item.name}</span>
              <span>{money(l.quantity * l.unitPriceCents)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t border-[var(--kb-panel-border)] pt-4">
          <span className="font-semibold text-[var(--kb-text)]">Total</span>
          <span className="font-semibold text-[var(--kb-text)]">{money(invoice.amountCents)}</span>
        </div>

        {paid === "1" && (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
            Payment received — thank you!
          </p>
        )}

        {gateways.length > 0 && (
          <div className="mt-4 border-t border-[var(--kb-panel-border)] pt-4">
            <p className="text-sm font-medium text-[var(--kb-text)]">Pay by card</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {gateways.map((g) => (
                <form key={g.provider} action={startPortalCheckoutAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="invoiceId" value={invoiceId} />
                  <input type="hidden" name="provider" value={g.provider} />
                  <button type="submit" className="kb-pill kb-pill-primary text-xs">
                    Pay with {PAYMENT_GATEWAYS[g.provider].label}
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}

        {(tenant.bankAccountNumber || tenant.whatsappVerifyNumber) && (
          <div className="mt-4 border-t border-[var(--kb-panel-border)] pt-4 text-sm">
            {tenant.bankAccountNumber && (
              <div className="mb-3">
                <p className="font-medium text-[var(--kb-text)]">Banking details</p>
                <p className="text-[var(--kb-text-dim)]">
                  {tenant.bankName && <>Bank: {tenant.bankName}<br /></>}
                  {tenant.bankAccountHolder && <>Account holder: {tenant.bankAccountHolder}<br /></>}
                  Account number: {tenant.bankAccountNumber}
                  {tenant.bankBranchCode && <>, Branch code: {tenant.bankBranchCode}</>}
                </p>
              </div>
            )}
            {tenant.whatsappVerifyNumber && (
              <div className="rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  Not sure this invoice is genuine? Message{" "}
                  <a
                    href={`https://wa.me/${tenant.whatsappVerifyNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                      `Hi, I'd like to verify an invoice from ${tenant.name}.`
                    )}`}
                    target="_blank"
                    className="font-semibold underline"
                  >
                    {tenant.name} on WhatsApp
                  </a>{" "}
                  to confirm before paying — never rely on the document alone.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
