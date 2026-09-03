// One customer's full picture — every quote, invoice, payment, delivery,
// and visit in one place, per the strategic report's "unified customer
// record" requirement (Section 7.1). Access to this page is already
// enforced by the tenant layout (requireTenantAccess).

import Link from "next/link";
import { notFound } from "next/navigation";
import { customerHistory, getOrCreatePortalToken } from "@/lib/core/parties";
import { totalPaid, totalRefunded } from "@/lib/core/money";
import { listRecurringInvoices } from "@/lib/core/recurring";
import { listComments } from "@/lib/core/comments";
import { prisma } from "@/lib/db";
import { addCustomerCommentAction } from "./comments-actions";
import { PhotoEventForm } from "./PhotoEventForm";
import { EditCustomerForm } from "./EditCustomerForm";
import {
  convertToInvoiceAction,
  recordPaymentAction,
  recordRefundAction,
  createRecurringInvoiceAction,
  toggleRecurringInvoiceAction,
  logPhotoEventAction,
} from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function CustomerHistoryPage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;

  // Checked before anything else that would touch this partyId (e.g.
  // getOrCreatePortalToken) — those don't scope to tenantId themselves, so
  // a stale link or a party id from another tenant needs to be rejected
  // right here rather than falling through to them.
  const history = await customerHistory(tenantId, id);
  if (!history) notFound();
  const { party, transactions, events } = history;

  const [portalToken, allRecurring, comments, memberships] = await Promise.all([
    getOrCreatePortalToken(id),
    listRecurringInvoices(tenantId),
    listComments(tenantId, "Party", id),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);
  const recurringForCustomer = allRecurring.filter((r) => r.partyId === id);

  const invoicedQuoteIds = new Set(
    transactions.filter((t) => t.type === "INVOICE" && t.parentId).map((t) => t.parentId as string)
  );
  const invoiceIds = transactions.filter((t) => t.type === "INVOICE").map((t) => t.id);
  const netPaidByInvoice = new Map<string, number>();
  for (const invoiceId of invoiceIds) {
    const [paid, refunded] = await Promise.all([totalPaid(invoiceId), totalRefunded(invoiceId)]);
    netPaidByInvoice.set(invoiceId, paid - refunded);
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">{party.name}</h1>
          <p className="text-sm text-[var(--kb-text-dim)]">
            {party.companyName ? `${party.companyName} · ` : ""}
            {party.phone ?? party.email ?? "no contact on file"}
          </p>
          {(party.addressLine || party.city) && (
            <p className="text-sm text-[var(--kb-text-dim)]">
              {[party.addressLine, party.city, party.postalCode, party.country].filter(Boolean).join(", ")}
            </p>
          )}
          {party.vatNumber && <p className="text-xs text-[var(--kb-text-dim)]">VAT: {party.vatNumber}</p>}
        </div>
      </div>
      <EditCustomerForm tenantId={tenantId} customerId={id} party={party} />

      <section className="kb-card mt-6 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Customer portal
        </h2>
        <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
          Send this link so {party.name} can view and sign their own quotes — no login needed.
        </p>
        <code className="mt-2 block truncate rounded-lg bg-black/5 px-3 py-2 text-xs text-[var(--kb-text)]">
          /portal/{portalToken}
        </code>
      </section>

      <section className="kb-card mt-6 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Quotes &amp; invoices
        </h2>
        <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
          {transactions
            .filter((t) => t.type !== "PAYMENT")
            .map((t) => (
              <li key={t.id} className="py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--kb-text)]">
                    {t.type}{" "}
                    <span className="text-[var(--kb-text-dim)]">&mdash; {t.status}</span>
                  </span>
                  <span className="text-[var(--kb-text)]">{money(t.amountCents)}</span>
                </div>
                {t.type === "QUOTE" && (
                  <Link
                    href={`/dashboard/${tenantId}/quotes/new?duplicate=${t.id}`}
                    className="mt-0.5 inline-block text-xs font-semibold text-[var(--kb-accent-a)] hover:underline"
                  >
                    Duplicate for another customer &rarr;
                  </Link>
                )}
                {t.type === "QUOTE" && t.openCount > 0 && (
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                    Opened {t.openCount}&times;
                    {t.lastOpenedAt && ` · last ${t.lastOpenedAt.toLocaleDateString()}`}
                    {t.openCount >= 2 && (
                      <span className="ml-1 font-semibold text-[var(--kb-accent-a)]">
                        · hot lead
                      </span>
                    )}
                  </p>
                )}
                {t.type === "QUOTE" && t.status === "ACCEPTED" && !invoicedQuoteIds.has(t.id) && (
                  <form action={convertToInvoiceAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="quoteId" value={t.id} />
                    <input type="hidden" name="customerId" value={id} />
                    <select
                      name="assigneeId"
                      defaultValue=""
                      className="rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs text-[var(--kb-text)]"
                    >
                      <option value="">No job card</option>
                      {memberships.map((m) => (
                        <option key={m.id} value={m.id}>
                          Assign to {m.user.name ?? m.user.email}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="text-xs font-semibold hover:underline">
                      Convert to invoice &rarr;
                    </button>
                  </form>
                )}
                {t.type === "INVOICE" && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-[var(--kb-text-dim)]">
                      Paid so far: {money(netPaidByInvoice.get(t.id) ?? 0)}
                    </span>
                    <form action={recordPaymentAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="invoiceId" value={t.id} />
                      <input type="hidden" name="customerId" value={id} />
                      <input
                        name="amountRand"
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        required
                        className="w-24 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs text-[var(--kb-text)]"
                      />
                      <button type="submit" className="text-xs font-semibold hover:underline">
                        Record payment
                      </button>
                    </form>
                    {(netPaidByInvoice.get(t.id) ?? 0) > 0 && (
                      <form action={recordRefundAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="invoiceId" value={t.id} />
                        <input type="hidden" name="customerId" value={id} />
                        <input
                          name="amountRand"
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          required
                          className="w-24 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs text-[var(--kb-text)]"
                        />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-[var(--kb-text-dim)] hover:underline"
                        >
                          Refund
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          {transactions.length === 0 && (
            <li className="py-2 text-sm text-[var(--kb-text-dim)]">Nothing yet.</li>
          )}
        </ul>
      </section>

      <section className="kb-card mt-6 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Recurring invoices
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Auto-generates and sends on schedule — no manual re-billing.
        </p>

        <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
          {recurringForCustomer.map((r) => {
            const lines = r.lines as unknown as { name: string; quantity: number; unitPriceCents: number }[];
            const amount = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
            return (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="text-[var(--kb-text)]">
                    {lines.map((l) => l.name).join(", ")} &mdash; {money(amount)} / {r.frequency.toLowerCase()}
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {r.isActive ? `Next: ${r.nextRunAt.toLocaleDateString()}` : "Paused"}
                  </p>
                </div>
                <form action={toggleRecurringInvoiceAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="customerId" value={id} />
                  <input type="hidden" name="templateId" value={r.id} />
                  <input type="hidden" name="nextActive" value={(!r.isActive).toString()} />
                  <button type="submit" className="text-xs font-semibold hover:underline">
                    {r.isActive ? "Pause" : "Resume"}
                  </button>
                </form>
              </li>
            );
          })}
          {recurringForCustomer.length === 0 && (
            <li className="py-2 text-sm text-[var(--kb-text-dim)]">None set up.</li>
          )}
        </ul>

        <form action={createRecurringInvoiceAction} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="customerId" value={id} />
          <div>
            <label className="block text-xs text-[var(--kb-text-dim)]">What for</label>
            <input
              name="itemName"
              required
              className="w-40 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-xs text-[var(--kb-text)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--kb-text-dim)]">Qty</label>
            <input
              name="quantity"
              type="number"
              defaultValue={1}
              min={1}
              className="w-16 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-xs text-[var(--kb-text)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--kb-text-dim)]">Price (ZAR)</label>
            <input
              name="priceRand"
              type="number"
              step="0.01"
              required
              className="w-24 rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-xs text-[var(--kb-text)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--kb-text-dim)]">Every</label>
            <select
              name="frequency"
              defaultValue="MONTHLY"
              className="rounded-lg border border-[var(--kb-panel-border)] bg-white px-2 py-1.5 text-xs text-[var(--kb-text)]"
            >
              <option value="WEEKLY">Week</option>
              <option value="MONTHLY">Month</option>
              <option value="QUARTERLY">Quarter</option>
            </select>
          </div>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">
            Set up
          </button>
        </form>
      </section>

      <section className="kb-card mt-6 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Deliveries, visits &amp; follow-ups
        </h2>
        <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
          {events.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <span className="font-medium text-[var(--kb-text)]">{e.type}</span>
              {e.notes && <span className="text-[var(--kb-text-dim)]"> &mdash; {e.notes}</span>}
              {e.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.photoUrl}
                  alt="Proof"
                  className="mt-2 h-24 rounded-lg border border-[var(--kb-panel-border)] object-cover"
                />
              )}
            </li>
          ))}
          {events.length === 0 && (
            <li className="py-2 text-sm text-[var(--kb-text-dim)]">Nothing yet.</li>
          )}
        </ul>
        <PhotoEventForm action={logPhotoEventAction} tenantId={tenantId} customerId={id} />
      </section>

      <section className="kb-card mt-6 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Notes &amp; comments
        </h2>
        <ul className="mt-3 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-[var(--kb-text)]">
                {c.body.split(/(@\w+)/g).map((part, i) =>
                  part.startsWith("@") ? (
                    <span key={i} className="font-semibold text-[var(--kb-accent-a)]">
                      {part}
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </p>
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                {c.authorName} · {c.createdAt.toLocaleString()}
              </p>
            </li>
          ))}
          {comments.length === 0 && (
            <li className="text-sm text-[var(--kb-text-dim)]">No notes yet.</li>
          )}
        </ul>
        <form action={addCustomerCommentAction} className="mt-4 flex gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="customerId" value={id} />
          <input
            name="body"
            required
            placeholder="Add a note — @mention a teammate to flag them"
            className="flex-1 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2 text-sm text-[var(--kb-text)]"
          />
          <button type="submit" className="kb-pill kb-pill-primary text-xs">
            Post
          </button>
        </form>
      </section>
    </main>
  );
}
