// One customer's full picture — every quote, invoice, payment, delivery,
// and visit in one place, per the strategic report's "unified customer
// record" requirement (Section 7.1). Access to this page is already
// enforced by the tenant layout (requireTenantAccess).

import { customerHistory, getOrCreatePortalToken } from "@/lib/core/parties";

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
