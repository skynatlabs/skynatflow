import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { totalPaid, totalRefunded, checkUnusualAmount } from "@/lib/core/money";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { invoiceWhatsAppMessage } from "@/lib/core/whatsappShare";
import { WhatsAppSendButton } from "@/components/dashboard/WhatsAppSendButton";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { DocumentSheet } from "@/components/dashboard/DocumentSheet";
import { RecordNotes } from "@/components/dashboard/RecordNotes";
import { listComments } from "@/lib/core/comments";
import { formatMoney } from "@/lib/core/currency";
import {
  recordPaymentAction,
  recordRefundAction,
  setInvoiceSalesPersonAction,
  setInvoiceReminderAction,
  clearInvoiceReminderAction,
} from "./actions";

function money(cents: number) {
  return formatMoney(cents, "ZAR", { decimals: true });
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
      itemLines: { include: { item: true }, orderBy: { sortOrder: "asc" } },
      party: true,
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!invoice || invoice.tenantId !== tenantId || invoice.type !== "INVOICE") notFound();

  const [tenant, paid, refunded, memberships, portalToken, unusual, template, notes] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    totalPaid(id),
    totalRefunded(id),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
    getOrCreatePortalToken(invoice.partyId),
    checkUnusualAmount({ tenantId, partyId: invoice.partyId, amountCents: invoice.amountCents, excludeTransactionId: id }),
    prisma.tenantPdfTemplate.findFirst({ where: { tenantId, isDefault: true }, select: { logoDataUrl: true } }),
    listComments(tenantId, "Transaction", id),
  ]);
  const netPaid = paid - refunded;
  const isLocked = LOCKED_STATUSES.has(invoice.status);

  const docNumber = invoice.externalRef ?? `INV-${invoice.id.slice(-6).toUpperCase()}`;

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 border-b border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-[var(--kb-text)]">{docNumber}</h1>
              <StatusPill status={invoice.status} />
            </div>
            <p className="truncate text-xs text-[var(--kb-text-dim)]">
              Invoice for {invoice.party.name} · {money(netPaid)} paid of {money(invoice.amountCents)}
              {isLocked && " · locked"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isLocked && (
              <Link href={`/dashboard/${tenantId}/invoices/${id}/edit`} className="kb-pill kb-pill-ghost text-xs">Edit</Link>
            )}
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
            <a href={`/portal/${portalToken}/invoices/${id}/pdf`} target="_blank" className="kb-pill kb-pill-ghost text-xs">PDF</a>
            <a href={`/dashboard/${tenantId}/invoices/${id}/docx`} className="kb-pill kb-pill-ghost text-xs">Word</a>
            <a href={`/portal/${portalToken}/invoices/${id}`} target="_blank" className="kb-pill kb-pill-ghost text-xs">View online</a>
          </div>
        </div>
        {unusual?.isUnusual && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This is {unusual.multiple.toFixed(1)}&times; what {invoice.party.name} normally pays ({money(unusual.averageCents)} average) — worth a second look before sending.
          </p>
        )}
      </div>

      <DocumentSheet
        kind="Invoice"
        number={docNumber}
        status={invoice.status}
        currency={invoice.currency ?? tenant.currency}
        logoDataUrl={template?.logoDataUrl}
        business={{
          name: tenant.name,
          address: tenant.businessAddress,
          email: tenant.businessEmail,
          phone: tenant.businessPhone,
          vatNumber: tenant.vatNumber,
          registrationNumber: tenant.registrationNumber,
          bankName: tenant.bankName,
          bankAccountHolder: tenant.bankAccountHolder,
          bankAccountNumber: tenant.bankAccountNumber,
          bankBranchCode: tenant.bankBranchCode,
        }}
        customer={invoice.party}
        issuedAt={invoice.createdAt}
        dueAt={invoice.dueAt}
        subject={invoice.subject}
        poNumber={invoice.poNumber}
        salesperson={invoice.salesPersonMembership ? (invoice.salesPersonMembership.user.name ?? invoice.salesPersonMembership.user.email) : null}
        lines={invoice.itemLines.map((l) => ({
          id: l.id,
          // The line's own wording is what the customer agreed to; the
          // catalogue's name sits under it as the thing it refers to.
          name: l.description ?? l.item.name,
          description: l.description ? l.item.name : l.item.description,
          sku: l.item.sku,
          unit: l.unit ?? l.item.unit,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPercent: l.discountPercent,
          taxRatePercent: l.taxRatePercent,
        }))}
        documentDiscountPercent={invoice.discountPercent ?? 0}
        amountCents={invoice.amountCents}
        paidCents={netPaid}
      />

      <div className="mx-auto max-w-[52rem] px-4 pb-10 sm:px-6">
      {invoice.status !== "PAID" && invoice.status !== "CANCELLED" && (
        <div className="kb-card mt-4 flex flex-wrap items-center gap-2 p-6">
          <form action={recordPaymentAction} className="flex items-center gap-1.5">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="invoiceId" value={id} />
            <input
              name="amountRand"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount"
              required
              className="w-28 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1.5 text-sm"
            />
            <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
          </form>
          {netPaid > 0 && (
            <form action={recordRefundAction} className="flex items-center gap-1.5">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="invoiceId" value={id} />
              <input
                name="amountRand"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount"
                required
                className="w-28 rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1.5 text-sm"
              />
              <SubmitButton pendingText="Refunding…" className="kb-pill kb-pill-ghost text-xs">
                Refund
              </SubmitButton>
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
          &quot;Call me back in 2 months&quot; — set the date and the follow-up engine holds off until then
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
      <div className="mt-4">
        <RecordNotes tenantId={tenantId} entityType="Transaction" entityId={id} notes={notes} />
      </div>
      </div>
    </div>
  );
}
