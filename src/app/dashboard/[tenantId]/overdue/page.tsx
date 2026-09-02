import { getOverdueInvoices } from "@/lib/core/collections";
import { applyLateFeeAction } from "./actions";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function OverduePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const overdue = await getOverdueInvoices(tenantId);
  const totalOwed = overdue.reduce((sum, i) => sum + i.amountCents, 0);

  const buckets = [
    { name: "0-7d", test: (d: number) => d <= 7, color: "#f0a3ac" },
    { name: "8-30d", test: (d: number) => d > 7 && d <= 30, color: "#e2445c" },
    { name: "30d+", test: (d: number) => d > 30, color: "#a3223c" },
  ];
  const barData = buckets.map((b) => ({
    name: b.name,
    value: Math.round(overdue.filter((i) => b.test(i.daysOverdue)).reduce((s, i) => s + i.amountCents, 0) / 100),
    color: b.color,
  }));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Overdue invoices</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every invoice past its due date, oldest first — {money(totalOwed)} outstanding across{" "}
        {overdue.length} invoice{overdue.length === 1 ? "" : "s"}.
      </p>

      {overdue.length > 0 && (
        <div className="mt-6">
          <BreakdownBarChart title="Overdue amount by age" data={barData} />
        </div>
      )}

      {overdue.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          Nothing overdue right now.
        </div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {overdue.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{inv.partyName}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {money(inv.amountCents)} · {inv.daysOverdue} day{inv.daysOverdue === 1 ? "" : "s"} overdue
                </p>
              </div>
              <form action={applyLateFeeAction} className="flex items-center gap-2">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="invoiceId" value={inv.id} />
                <input type="hidden" name="feePercent" value="5" />
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  + 5% late fee
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
