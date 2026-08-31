import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { totalPaid, totalRefunded } from "@/lib/core/money";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { recordPaymentAction, recordRefundAction, setInvoiceSalesPersonAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const LOCKED_STATUSES = new Set(["PAID", "PARTIALLY_PAID", "CANCELLED"]);

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;

  const invoice = await prisma.transaction.findUnique({
    where: { id },
    include: {
      itemLines: { include: { item: true } },
      party: true,
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!invoice || invoice.tenantId !== tenantId || invoice.type !== "INVOICE") notFound();

  const [paid, refunded, memberships, portalToken] = await Promise.all([
    totalPaid(id),
    totalRefunded(id),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
    getOrCreatePortalToken(invoice.partyId),
  ]);
  const netPaid = paid - refunded;
  const isLocked = LOCKED_STATUSES.has(invoice.status);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--kb-text)]">
            Invoice for {invoice.party.name}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">
            Status: <span className="font-medium">{invoice.status}</span>
            {isLocked && " — locked, can't be edited"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isLocked && (
            <Link href={`/dashboard/${tenantId}/invoices/${id}/edit`} className="kb-pill kb-pill-ghost text-xs">
              Edit
            </Link>
          )}
          <a href={`/portal/${portalToken}/invoices/${id}/pdf`} target="_blank" className="kb-pill kb-pill-ghost text-xs">
            Download PDF
          </a>
          <a href={`/portal/${portalToken}/invoices/${id}`} target="_blank" className="kb-pill kb-pill-ghost text-xs">
            View online
          </a>
        </div>
      </div>

      {(invoice.subject || invoice.poNumber) && (
        <div className="mt-3 text-sm text-[var(--kb-text-dim)]">
          {invoice.subject && <p>{invoice.subject}</p>}
          {invoice.poNumber && <p className="text-xs">PO #: {invoice.poNumber}</p>}
        </div>
      )}

      <div className="kb-card mt-6 p-6">
        <ul className="divide-y divide-[var(--kb-panel-border)]">
          {invoice.itemLines.map((l) => {
            const gross = l.quantity * l.unitPriceCents;
            const afterDiscount = gross * (1 - (l.discountPercent ?? 0) / 100);
            const lineTotal = afterDiscount * (1 + (l.taxRatePercent ?? 0) / 100);
            return (
              <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-[var(--kb-text)]">
                  {l.quantity} &times; {l.item.name}
                  {(l.discountPercent || l.taxRatePercent) && (
                    <span className="text-[var(--kb-text-dim)]">
                      {" "}
                      ({l.discountPercent ? `${l.discountPercent}% disc` : ""}
                      {l.discountPercent && l.taxRatePercent ? ", " : ""}
                      {l.taxRatePercent ? `${l.taxRatePercent}% tax` : ""})
                    </span>
                  )}
                </span>
                <span className="text-[var(--kb-text)]">{money(lineTotal)}</span>
              </li>
            );
          })}
        </ul>
        {(invoice.discountPercent ?? 0) > 0 && (
          <div className="mt-1 flex justify-between text-xs text-[var(--kb-text-dim)]">
            <span>Overall discount</span>
            <span>{invoice.discountPercent}%</span>
          </div>
        )}
        <div className="mt-3 flex justify-between border-t border-[var(--kb-panel-border)] pt-3">
          <span className="font-semibold text-[var(--kb-text)]">Total</span>
          <span className="font-bold text-[var(--kb-text)]">{money(invoice.amountCents)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-[var(--kb-text-dim)]">
          <span>Paid so far</span>
          <span>{money(netPaid)}</span>
        </div>
      </div>

      {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
        <div className="kb-card mt-4 flex flex-wrap items-center gap-2 p-6">
          <form action={recordPaymentAction} className="flex items-center gap-1.5">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="invoiceId" value={id} />
            <input
              name="amountRand"
              type="number"
              step="0.01"
              placeholder="Amount"
              required
              className="w-28 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-sm"
            />
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Record payment
            </button>
          </form>
          {netPaid > 0 && (
            <form action={recordRefundAction} className="flex items-center gap-1.5">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="invoiceId" value={id} />
              <input
                name="amountRand"
                type="number"
                step="0.01"
                placeholder="Amount"
                required
                className="w-28 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-sm"
              />
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                Refund
              </button>
            </form>
          )}
        </div>
      )}

      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Salesperson
        </h2>
        <form action={setInvoiceSalesPersonAction} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="invoiceId" value={id} />
          <select
            name="salesPersonMembershipId"
            defaultValue={invoice.salesPersonMembershipId ?? ""}
            className="rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
          >
            <option value="">Not assigned</option>
            {memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.name ?? m.user.email}
              </option>
            ))}
          </select>
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">
            Save
          </button>
        </form>
        {invoice.salesPersonMembership && (
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            {invoice.salesPersonMembership.user.email}
            {invoice.salesPersonMembership.user.phone && ` · ${invoice.salesPersonMembership.user.phone}`}
          </p>
        )}
      </div>
    </div>
  );
}
