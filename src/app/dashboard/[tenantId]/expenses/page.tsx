import { listExpenses } from "@/lib/core/expenses";
import { submitExpenseAction, approveExpenseAction, rejectExpenseAction } from "./actions";
import { ReceiptUploadForm } from "./ReceiptUploadForm";
import { Pagination } from "@/components/dashboard/Pagination";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const STATUS_TINT: Record<string, string> = {
  PENDING: "kb-tint-yellow",
  APPROVED: "kb-tint-mint",
  REJECTED: "kb-tint-peach",
};

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const { items: expenses, pageCount } = await listExpenses(tenantId, undefined, page);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Expenses</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Staff expenses with an optional attached slip — submit, approve, done.
      </p>

      <ReceiptUploadForm action={submitExpenseAction} tenantId={tenantId} />

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {expenses.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-[var(--kb-text)]">
                {e.descriptionText} · {money(e.amountCents)}
              </p>
              <p className="text-xs text-[var(--kb-text-dim)]">
                {e.submittedByName}
                {e.category ? ` · ${e.category}` : ""}
                {e.receiptDataUrl ? " · slip attached" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`kb-tile ${STATUS_TINT[e.status]} !py-1 !px-3 text-[11px] font-semibold`}>
                {e.status}
              </span>
              {e.status === "PENDING" && (
                <>
                  <form action={approveExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Approve</button>
                  </form>
                  <form action={rejectExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Reject</button>
                  </form>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} />
    </main>
  );
}
