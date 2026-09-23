// The credit book.
//
// Designed for the counter rather than the desk: the entry form is the first
// thing on the page, not the last, because the reason paper wins is that
// paper is already open. Two fields and an amount, and the customer does not
// have to exist yet.
//
// The book below is ordered by age, not by size. A big debt from yesterday
// is trade; a small one from four months ago is somebody who is not coming
// back, and that is the row worth looking at.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { listCustomers } from "@/lib/core/parties";
import { theBook } from "@/lib/core/khata";
import { addCreditEntryAction, addRepaymentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CreditBookPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [book, customers, currency] = await Promise.all([
    theBook(tenantId),
    listCustomers(tenantId),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const owing = book.rows;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Credit book</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        What people took and have not paid for yet. Every entry here is a real invoice in the
        books, so it counts in your balances, your statements and your VAT — there is no second
        set of numbers to reconcile at month end.
      </p>

      {/* The counter comes first. */}
      <form
        action={addCreditEntryAction}
        className="kb-card mt-6 grid gap-3 p-4 sm:grid-cols-[1.2fr_1fr_1.4fr_auto]"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Who</span>
          <input
            name="customerName"
            required
            placeholder="Thandi"
            className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Number (optional)</span>
          <input
            name="phone"
            inputMode="tel"
            placeholder="072 123 4567"
            className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">What they took</span>
          <input
            name="description"
            required
            placeholder="bread and milk"
            className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Amount</span>
          <div className="mt-1 flex gap-2">
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
            <button type="submit" className="kb-pill kb-pill-primary whitespace-nowrap text-xs">
              Write it in
            </button>
          </div>
        </label>
      </form>

      {owing.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">Out on credit</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {money(book.totalOwedCents)}
            </p>
          </div>
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">Sitting over two months</p>
            <p
              className="mt-1 text-xl font-semibold tabular-nums"
              style={{
                color: book.goneBadCents > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
              }}
            >
              {money(book.goneBadCents)}
            </p>
          </div>
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">People</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {owing.length}
            </p>
          </div>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Oldest first</h2>
      {owing.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          Nobody owes anything.
        </div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {owing.map((row) => {
            const bad = (row.oldestDays ?? 0) > 60;
            return (
              <li key={row.partyId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--kb-text)]">{row.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {row.phone ?? "no number"}
                    {row.oldestDays !== null && (
                      <>
                        {" "}
                        &middot;{" "}
                        <span style={bad ? { color: "var(--kb-status-danger-ink)" } : undefined}>
                          oldest {row.oldestDays} days
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <p className="tabular-nums font-semibold text-[var(--kb-text)]">
                  {money(row.owesCents)}
                </p>
                <form action={addRepaymentAction} className="flex items-center gap-2">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="partyId" value={row.partyId} />
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="paid"
                    className="w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-sm"
                  />
                  <button type="submit" className="kb-pill text-xs">
                    Paid
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
        A payment goes against the oldest entry first. If somebody pays more than they owe, it
        says so rather than holding the difference somewhere you would not find it.
      </p>

      {customers.length > 0 && (
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
          {customers.length} customer{customers.length === 1 ? "" : "s"} on record. Writing a new
          name into the form above adds them.
        </p>
      )}
    </main>
  );
}
