// Questions before the money goes.
//
// Every row is a question with the fact that prompted it, and nothing on
// this page blocks a payment. That is deliberate and it is the difference
// between a control that works and one that gets switched off: a system that
// cries wolf is ignored, and one that blocks payments is worked around.
//
// Suppliers genuinely do change banks. Two companies genuinely can be called
// Mahlangu Trading. The software's job is to make sure somebody was asked.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { screenBills, lookalikeSuppliers } from "@/lib/core/supplierRisk";
import { setBankDetailsAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  BANK_DETAILS_CHANGED: "Bank details",
  LOOKALIKE_SUPPLIER: "Two similar names",
  DUPLICATE_REFERENCE: "Invoice number seen before",
  SAME_AMOUNT_RECENTLY: "Same amount recently",
  JUST_UNDER_APPROVAL: "Just under the limit",
  APPROVED_AND_PAID_BY_ONE_PERSON: "One person on both sides",
};

export default async function BillCheckPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [screen, duplicates, suppliers, currency] = await Promise.all([
    screenBills({ tenantId }),
    lookalikeSuppliers(tenantId),
    prisma.party.findMany({
      where: { tenantId, role: "SUPPLIER" },
      select: {
        id: true,
        name: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountHolder: true,
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const withoutDetails = suppliers.filter((s) => !s.bankAccountNumber);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Before you pay</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        The questions a careful finance person would ask on every bill if they had time. Nothing
        here is a finding and nothing here blocks a payment &mdash; suppliers really do change
        banks, and two companies really can be called the same thing. The point is that somebody
        was asked.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Bills waiting</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {screen.billsChecked}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Questions</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{
              color: screen.flags.length > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text)",
            }}
          >
            {screen.flags.length}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Suppliers with no details on file</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {withoutDetails.length}
          </p>
        </div>
      </div>

      {screen.flags.length === 0 ? (
        <div className="kb-card mt-6 p-5 text-sm text-[var(--kb-text-dim)]">{screen.summary}</div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {screen.flags.map((flag, i) => (
            <li key={`${flag.billId}-${flag.kind}-${i}`} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-[var(--kb-text)]">{flag.question}</p>
                <span className="text-sm tabular-nums text-[var(--kb-text-dim)]">
                  {money(flag.amountCents)}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{flag.because}</p>
              <p className="mt-1.5 text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                {KIND_LABEL[flag.kind] ?? flag.kind}
              </p>
            </li>
          ))}
        </ul>
      )}

      {duplicates.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">
            Suppliers with almost the same name
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
            Usually one supplier entered twice, which splits their spend across two rows and makes
            every supplier report wrong. Occasionally it is not that.
          </p>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {duplicates.slice(0, 20).map((pair) => (
              <li key={`${pair.aId}-${pair.bId}`} className="px-5 py-3 text-sm">
                <span className="text-[var(--kb-text)]">{pair.aName}</span>
                <span className="mx-2 text-[var(--kb-text-dim)]">and</span>
                <span className="text-[var(--kb-text)]">{pair.bName}</span>
                <span className="ml-2 text-xs text-[var(--kb-text-dim)]">
                  {pair.edits === 0 ? "identical once suffixes are ignored" : `${pair.edits} characters apart`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Where suppliers get paid</h2>
        <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
          Every change is kept, with who made it. If a supplier emails asking you to change these,
          ring the number you already had for them &mdash; never one on the new document.
        </p>
        <form action={setBankDetailsAction} className="kb-card mt-3 grid gap-2 p-4 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs sm:col-span-2">
            <span className="block font-medium text-[var(--kb-text-dim)]">Supplier</span>
            <select
              name="partyId"
              required
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.bankAccountNumber ? ` — ${s.bankAccountNumber}` : " — nothing on file"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Bank</span>
            <input name="bankName" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Account holder</span>
            <input name="accountHolder" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <label className="text-xs sm:col-span-2">
            <span className="block font-medium text-[var(--kb-text-dim)]">Account number</span>
            <input name="accountNumber" inputMode="numeric" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Save details
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
