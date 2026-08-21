// One customer's full picture — every quote, invoice, payment, delivery,
// and visit in one place, per the strategic report's "unified customer
// record" requirement (Section 7.1). Access to this page is already
// enforced by the tenant layout (requireTenantAccess).

import { customerHistory, getOrCreatePortalToken } from "@/lib/core/parties";
import { totalPaid, totalRefunded } from "@/lib/core/money";
import { convertToInvoiceAction, recordPaymentAction, recordRefundAction } from "./actions";

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
  const [{ party, transactions, events }, portalToken] = await Promise.all([
    customerHistory(tenantId, id),
    getOrCreatePortalToken(id),
  ]);

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
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">{party.name}</h1>
      <p className="text-sm text-[var(--kb-text-dim)]">{party.phone ?? party.email}</p>

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
                  <form action={convertToInvoiceAction} className="mt-2">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="quoteId" value={t.id} />
                    <input type="hidden" name="customerId" value={id} />
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
          Deliveries, visits &amp; follow-ups
        </h2>
        <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
          {events.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <span className="font-medium text-[var(--kb-text)]">{e.type}</span>
              {e.notes && <span className="text-[var(--kb-text-dim)]"> &mdash; {e.notes}</span>}
            </li>
          ))}
          {events.length === 0 && (
            <li className="py-2 text-sm text-[var(--kb-text-dim)]">Nothing yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
