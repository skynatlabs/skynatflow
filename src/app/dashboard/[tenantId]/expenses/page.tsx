import { listExpenses, spendSplit } from "@/lib/core/expenses";
import { submitExpenseAction, approveExpenseAction, rejectExpenseAction, classifyExpenseAction } from "./actions";
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
  const [{ items: expenses, pageCount }, split] = await Promise.all([
    listExpenses(tenantId, undefined, page),
    spendSplit(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Expenses</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Staff expenses with an optional attached slip — submit, approve, done.
      </p>

      {/* What it actually costs to run this, versus what the owner took out.
          The unreviewed tile is deliberately as prominent as the other two —
          hiding it would reproduce the exact error this is here to fix. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Business costs
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">
            {money(split.businessCents)}
          </p>
        </div>
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Owner drawings
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">
            {money(split.drawingsCents)}
          </p>
        </div>
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
            Not split yet
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">
            {money(split.unreviewedCents)}
          </p>
          <p className="text-[10px] text-[var(--kb-text-dim)]">
            {split.unreviewedCount} payment{split.unreviewedCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {split.summary && (
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{split.summary}</p>
      )}

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
            <div className="flex flex-wrap items-center justify-end gap-2">
              {e.isOwnerDrawing === null ? (
                <span className="flex items-center gap-1">
                  <form action={classifyExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <input type="hidden" name="isOwnerDrawing" value="false" />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">
                      Business
                    </button>
                  </form>
                  <form action={classifyExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <input type="hidden" name="isOwnerDrawing" value="true" />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">
                      Personal
                    </button>
                  </form>
                </span>
              ) : (
                e.isOwnerDrawing && (
                  <span className="kb-pill text-[10px] uppercase text-[var(--kb-text-dim)]">
                    Personal
                  </span>
                )
              )}
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
