import { getQuoteSlaBreaches } from "@/lib/core/sla";
import { sendQuoteNowAction } from "./actions";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function UnsentQuotesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const breaches = await getQuoteSlaBreaches(tenantId);
  const totalAmountCents = breaches.reduce((s, b) => s + b.amountCents, 0);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Quotes waiting to be sent</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The faster a quote goes out, the more likely you win the job — most customers have moved
        on to another option within 30 minutes of asking.
      </p>

      {breaches.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="kb-tile kb-tint-yellow">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Waiting</p>
            <p className="mt-2 text-3xl font-extrabold">{breaches.length}</p>
          </div>
          <div className="kb-tile kb-tint-peach">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Value stuck</p>
            <p className="mt-2 text-3xl font-extrabold">{money(totalAmountCents)}</p>
          </div>
        </div>
      )}

      {breaches.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          Nothing waiting — every quote has gone out on time.
        </div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {breaches.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{b.partyName}</p>
                <p className="text-xs text-[var(--kb-tint-peach-ink)]">
                  {money(b.amountCents)} · waiting {b.minutesWaiting} min
                </p>
              </div>
              <form action={sendQuoteNowAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="quoteId" value={b.id} />
                <button type="submit" className="kb-pill kb-pill-primary text-xs">
                  Send now
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
