// Invoice view — the invoice-side counterpart to the quote portal page.
// No signature/acceptance step (that already happened at the quote
// stage); this is just a clean, shareable "here's what you owe" view
// with a PDF download link.

import { notFound } from "next/navigation";
import Link from "next/link";
import { findPartyByPortalToken } from "@/lib/core/parties";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function PortalInvoicePage({
  params,
}: {
  params: Promise<{ token: string; invoiceId: string }>;
}) {
  const { token, invoiceId } = await params;
  const party = await findPartyByPortalToken(token);
  if (!party) notFound();

  const invoice = await prisma.transaction.findUnique({
    where: { id: invoiceId },
    include: { itemLines: { include: { item: true } } },
  });
  if (!invoice || invoice.partyId !== party.id || invoice.type !== "INVOICE") notFound();

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
      </div>
    </main>
  );
}
