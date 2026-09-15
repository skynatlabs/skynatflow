import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import { checkUnusualAmount } from "@/lib/core/money";
import { quoteWhatsAppMessage } from "@/lib/core/whatsappShare";
import { WhatsAppSendButton } from "@/components/dashboard/WhatsAppSendButton";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { DocumentSheet } from "@/components/dashboard/DocumentSheet";
import { formatMoney } from "@/lib/core/currency";
import {
  sendQuoteAction,
  sendQuoteViaWhatsAppAction,
  markQuoteOutcomeAction,
  convertQuoteToInvoiceAction,
  setQuoteSalesPersonAction,
  setQuoteReminderAction,
  clearQuoteReminderAction,
} from "./actions";

function money(cents: number) {
  return formatMoney(cents, "ZAR", { decimals: true });
}

const LOCKED_STATUSES = new Set(["ACCEPTED", "DECLINED", "CANCELLED"]);

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;

  const quote = await prisma.transaction.findUnique({
    where: { id },
    include: {
      itemLines: { include: { item: true } },
      party: true,
      salesPersonMembership: { include: { user: true } },
    },
  });
  if (!quote || quote.tenantId !== tenantId || quote.type !== "QUOTE") notFound();

  const [tenant, memberships, invoicedChild, portalToken, unusual, template] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
    prisma.transaction.findFirst({ where: { parentId: id, type: "INVOICE" } }),
    getOrCreatePortalToken(quote.partyId),
    checkUnusualAmount({ tenantId, partyId: quote.partyId, amountCents: quote.amountCents, excludeTransactionId: id }),
    prisma.tenantPdfTemplate.findFirst({ where: { tenantId, isDefault: true }, select: { logoDataUrl: true } }),
  ]);

  const isLocked = LOCKED_STATUSES.has(quote.status);

  const docNumber = quote.externalRef ?? `QT-${quote.id.slice(-6).toUpperCase()}`;

  return (
    <div className="min-h-full">
      {/* The action bar, as in every document tool: what it is on the left,
          what can be done to it on the right. The document is below it. */}
      <div className="sticky top-0 z-20 border-b border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-[var(--kb-text)]">{docNumber}</h1>
              <StatusPill status={quote.status} />
            </div>
            <p className="truncate text-xs text-[var(--kb-text-dim)]">
              {quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote"} for {quote.party.name}
              {isLocked && " · locked"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isLocked && (
              <Link href={`/dashboard/${tenantId}/quotes/${id}/edit`} className="kb-pill kb-pill-ghost text-xs">Edit</Link>
            )}
        {quote.status === "DRAFT" && (
          <>
            <WhatsAppSendButton
              phone={quote.party.phone}
              message={quoteWhatsAppMessage({
                tenantName: tenant.name,
                customerName: quote.party.name,
                amountLabel: money(quote.amountCents),
                viewUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com"}/portal/${portalToken}/quotes/${id}`,
              })}
              markSentAction={sendQuoteViaWhatsAppAction.bind(null, tenantId, id)}
            />
            <form action={sendQuoteAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="quoteId" value={id} />
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                Mark sent (no WhatsApp)
              </button>
            </form>
          </>
        )}
        {quote.status === "SENT" && (
          <>
            <form action={markQuoteOutcomeAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="quoteId" value={id} />
              <input type="hidden" name="outcome" value="ACCEPTED" />
              <button type="submit" className="kb-pill kb-pill-primary text-xs">
                Mark accepted
              </button>
            </form>
            <form action={markQuoteOutcomeAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="quoteId" value={id} />
              <input type="hidden" name="outcome" value="DECLINED" />
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                Mark declined
              </button>
            </form>
          </>
        )}
        {quote.status === "ACCEPTED" && !invoicedChild && (
          <form action={convertQuoteToInvoiceAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="quoteId" value={id} />
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Convert to invoice
            </button>
          </form>
        )}
        {invoicedChild && (
          <Link href={`/dashboard/${tenantId}/invoices/${invoicedChild.id}`} className="text-xs font-semibold hover:underline">
            View invoice &rarr;
          </Link>
        )}
            <a href={`/portal/${portalToken}/quotes/${id}/pdf`} target="_blank" className="kb-pill kb-pill-ghost text-xs">PDF</a>
            <a href={`/portal/${portalToken}/quotes/${id}`} target="_blank" className="kb-pill kb-pill-ghost text-xs">View online</a>
            <Link href={`/dashboard/${tenantId}/quotes/new?duplicate=${id}`} className="kb-pill kb-pill-ghost text-xs">Duplicate</Link>
          </div>
        </div>
        {unusual?.isUnusual && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This is {unusual.multiple.toFixed(1)}&times; what {quote.party.name} normally pays ({money(unusual.averageCents)} average) — worth a second look before sending.
          </p>
        )}
      </div>

      <DocumentSheet
        kind={quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote"}
        number={docNumber}
        status={quote.status}
        currency={quote.currency ?? tenant.currency}
        logoDataUrl={template?.logoDataUrl}
        business={{
          name: tenant.name,
          address: tenant.businessAddress,
          email: tenant.businessEmail,
          phone: tenant.businessPhone,
          vatNumber: tenant.vatNumber,
          registrationNumber: tenant.registrationNumber,
        }}
        customer={quote.party}
        issuedAt={quote.createdAt}
        dueAt={quote.dueAt}
        subject={quote.subject}
        poNumber={quote.poNumber}
        salesperson={quote.salesPersonMembership ? (quote.salesPersonMembership.user.name ?? quote.salesPersonMembership.user.email) : null}
        introText={quote.quoteKind === "PROPOSAL" ? quote.introText : null}
        scopeOfWork={quote.quoteKind === "PROPOSAL" ? quote.scopeOfWork : null}
        lines={quote.itemLines.map((l) => ({
          id: l.id,
          name: l.item.name,
          description: l.item.description,
          sku: l.item.sku,
          unit: l.item.unit,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPercent: l.discountPercent,
          taxRatePercent: l.taxRatePercent,
        }))}
        documentDiscountPercent={quote.discountPercent ?? 0}
        amountCents={quote.amountCents}
      />

      <div className="mx-auto max-w-[52rem] px-4 pb-10 sm:px-6">
      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Salesperson
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Shown on this quote&apos;s PDF/online view alongside the business — lets the customer see and
          contact who sent it.
        </p>
        <form action={setQuoteSalesPersonAction} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="quoteId" value={id} />
          <select
            name="salesPersonMembershipId"
            defaultValue={quote.salesPersonMembershipId ?? ""}
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
        {quote.salesPersonMembership && (
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            {quote.salesPersonMembership.user.email}
            {quote.salesPersonMembership.user.phone && ` · ${quote.salesPersonMembership.user.phone}`}
          </p>
        )}
      </div>

      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Reminder
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          &quot;Call me back in 2 months&quot; — set the date and the follow-up engine holds off until then
          instead of nudging on the usual schedule. Shows up on your This Week board when it&apos;s due.
        </p>
        {quote.nextFollowUpAt && (
          <div className="mt-3 rounded-lg bg-[var(--kb-panel)] p-3 text-sm">
            <p className="font-medium text-[var(--kb-text)]">
              {new Date(quote.nextFollowUpAt).toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            {quote.followUpNote && <p className="mt-0.5 text-[var(--kb-text-dim)]">{quote.followUpNote}</p>}
            <div className="mt-2 flex items-center gap-3">
              <a
                href={`/api/dashboard/${tenantId}/reminders/${id}/ics`}
                className="text-xs font-semibold text-[var(--kb-accent-a)] hover:underline"
              >
                Add to calendar
              </a>
              <form action={clearQuoteReminderAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="quoteId" value={id} />
                <button type="submit" className="text-xs text-[var(--kb-text-dim)] hover:underline">
                  Clear reminder
                </button>
              </form>
            </div>
          </div>
        )}
        <form action={setQuoteReminderAction} className="mt-3 space-y-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="quoteId" value={id} />
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
              placeholder="Why? e.g. Said he'll be ready in 2 months"
              className="flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </div>
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">
            {quote.nextFollowUpAt ? "Update reminder" : "Set reminder"}
          </button>
        </form>
      </div>
      </div>
    </div>
  );
}
