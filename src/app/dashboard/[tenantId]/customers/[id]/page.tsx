// One customer's full picture — every quote, invoice, payment, delivery,
// and visit in one place, per the strategic report's "unified customer
// record" requirement (Section 7.1).

import { customerHistory } from "@/lib/core/parties";

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
  const { party, transactions, events } = await customerHistory(tenantId, id);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">{party.name}</h1>
      <p className="text-sm text-[var(--kb-text-dim)]">{party.phone ?? party.email}</p>

      <section className="kb-glass mt-8 rounded-2xl p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--kb-text-dim)]">
          Quotes &amp; invoices
        </h2>
        <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
          {transactions
            .filter((t) => t.type !== "PAYMENT")
            .map((t) => (
              <li key={t.id} className="flex justify-between py-2 text-sm">
                <span className="text-[var(--kb-text)]">
                  {t.type}{" "}
                  <span className="text-[var(--kb-text-dim)]">&mdash; {t.status}</span>
                </span>
                <span className="text-[var(--kb-text)]">{money(t.amountCents)}</span>
              </li>
            ))}
          {transactions.length === 0 && (
            <li className="py-2 text-sm text-[var(--kb-text-dim)]">Nothing yet.</li>
          )}
        </ul>
      </section>

      <section className="kb-glass mt-6 rounded-2xl p-6">
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
