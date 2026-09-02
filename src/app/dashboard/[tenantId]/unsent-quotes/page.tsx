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
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {breaches.map((b) => (
            <div key={b.id} className="kb-tile kb-tint-peach flex flex-col justify-between">
              <div>
                <p className="font-semibold">{b.partyName}</p>
                <p className="mt-1 text-xs opacity-80">
                  {money(b.amountCents)} · waiting {b.minutesWaiting} min
                </p>
              </div>
              <form action={sendQuoteNowAction} className="mt-4">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="quoteId" value={b.id} />
                <button type="submit" className="kb-pill kb-pill-primary text-xs">
                  Send now
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
