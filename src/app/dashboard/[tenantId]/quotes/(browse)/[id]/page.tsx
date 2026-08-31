import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getOrCreatePortalToken } from "@/lib/core/parties";
import {
  sendQuoteAction,
  markQuoteOutcomeAction,
  convertQuoteToInvoiceAction,
  setQuoteSalesPersonAction,
  setQuoteReminderAction,
  clearQuoteReminderAction,
} from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
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

  const [memberships, invoicedChild, portalToken] = await Promise.all([
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
    prisma.transaction.findFirst({ where: { parentId: id, type: "INVOICE" } }),
    getOrCreatePortalToken(quote.partyId),
  ]);

  const isLocked = LOCKED_STATUSES.has(quote.status);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--kb-text)]">
            {quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote"} for {quote.party.name}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">
            Status: <span className="font-medium">{quote.status}</span>
            {isLocked && " — locked, can't be edited"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isLocked && (
            <Link href={`/dashboard/${tenantId}/quotes/${id}/edit`} className="kb-pill kb-pill-ghost text-xs">
              Edit
            </Link>
          )}
          <Link href={`/dashboard/${tenantId}/quotes/new?duplicate=${id}`} className="kb-pill kb-pill-ghost text-xs">
            Duplicate
          </Link>
          <a href={`/portal/${portalToken}/quotes/${id}/pdf`} target="_blank" className="kb-pill kb-pill-ghost text-xs">
            Download PDF
          </a>
          <a href={`/portal/${portalToken}/quotes/${id}`} target="_blank" className="kb-pill kb-pill-ghost text-xs">
            View online
          </a>
        </div>
      </div>

      {(quote.subject || quote.poNumber) && (
        <div className="mt-3 text-sm text-[var(--kb-text-dim)]">
          {quote.subject && <p>{quote.subject}</p>}
          {quote.poNumber && <p className="text-xs">PO #: {quote.poNumber}</p>}
        </div>
      )}

      <div className="kb-card mt-6 p-6">
        <ul className="divide-y divide-[var(--kb-panel-border)]">
          {quote.itemLines.map((l) => {
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
        {(quote.discountPercent ?? 0) > 0 && (
          <div className="mt-1 flex justify-between text-xs text-[var(--kb-text-dim)]">
            <span>Overall discount</span>
            <span>{quote.discountPercent}%</span>
          </div>
        )}
        <div className="mt-3 flex justify-between border-t border-[var(--kb-panel-border)] pt-3">
          <span className="font-semibold text-[var(--kb-text)]">Total</span>
          <span className="font-bold text-[var(--kb-text)]">{money(quote.amountCents)}</span>
        </div>
      </div>

      <div className="kb-card mt-4 flex flex-wrap items-center gap-2 p-6">
        {quote.status === "DRAFT" && (
          <form action={sendQuoteAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="quoteId" value={id} />
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Send to customer
            </button>
          </form>
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
      </div>

      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Salesperson
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Shown on this quote's PDF/online view alongside the business — lets the customer see and
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
          "Call me back in 2 months" — set the date and the follow-up engine holds off until then
          instead of nudging on the usual schedule. Shows up on your This Week board when it's due.
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
  );
}
