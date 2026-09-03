import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { totalPaid, totalRefunded, checkUnusualAmount } from "@/lib/core/money";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { invoiceWhatsAppMessage } from "@/lib/core/whatsappShare";
import { WhatsAppSendButton } from "@/components/dashboard/WhatsAppSendButton";
import {
  recordPaymentAction,
  recordRefundAction,
  setInvoiceSalesPersonAction,
  setInvoiceReminderAction,
  clearInvoiceReminderAction,
} from "./actions";

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

  const [tenant, paid, refunded, memberships, portalToken, unusual] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    totalPaid(id),
    totalRefunded(id),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
    getOrCreatePortalToken(invoice.partyId),
    checkUnusualAmount({ tenantId, partyId: invoice.partyId, amountCents: invoice.amountCents, excludeTransactionId: id }),
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
          <WhatsAppSendButton
            phone={invoice.party.phone}
            label="Send via WhatsApp"
            message={invoiceWhatsAppMessage({
              tenantName: tenant.name,
              customerName: invoice.party.name,
              amountLabel: money(invoice.amountCents),
              viewUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com"}/portal/${portalToken}/invoices/${id}`,
            })}
          />
        </div>
      </div>

      {(invoice.subject || invoice.poNumber) && (
        <div className="mt-3 text-sm text-[var(--kb-text-dim)]">
          {invoice.subject && <p>{invoice.subject}</p>}
          {invoice.poNumber && <p className="text-xs">PO #: {invoice.poNumber}</p>}
        </div>
      )}

      {unusual?.isUnusual && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ This is {unusual.multiple.toFixed(1)}&times; what {invoice.party.name} normally pays
          ({money(unusual.averageCents)} average) — worth a second look before sending.
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

      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Reminder
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          "Call me back in 2 months" — set the date and the follow-up engine holds off until then
          instead of chasing payment on the usual schedule.
        </p>
        {invoice.nextFollowUpAt && (
          <div className="mt-3 rounded-lg bg-[var(--kb-panel)] p-3 text-sm">
            <p className="font-medium text-[var(--kb-text)]">
              {new Date(invoice.nextFollowUpAt).toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            {invoice.followUpNote && <p className="mt-0.5 text-[var(--kb-text-dim)]">{invoice.followUpNote}</p>}
            <div className="mt-2 flex items-center gap-3">
              <a
                href={`/api/dashboard/${tenantId}/reminders/${id}/ics`}
                className="text-xs font-semibold text-[var(--kb-accent-a)] hover:underline"
              >
                Add to calendar
              </a>
              <form action={clearInvoiceReminderAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="invoiceId" value={id} />
                <button type="submit" className="text-xs text-[var(--kb-text-dim)] hover:underline">
                  Clear reminder
                </button>
              </form>
            </div>
          </div>
        )}
        <form action={setInvoiceReminderAction} className="mt-3 space-y-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="invoiceId" value={id} />
          <div className="flex items-center gap-2">
            <input
              type="date"
              name="remindAt"
              required
              className="rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
            <input
              type="text"
              name="note"
              placeholder="Why? e.g. Said he'll pay after month-end"
              className="flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </div>
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">
            {invoice.nextFollowUpAt ? "Update reminder" : "Set reminder"}
          </button>
        </form>
      </div>
    </div>
  );
}
