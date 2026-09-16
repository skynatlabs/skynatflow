// What you owe — the other half of the ledger.
//
// The books have always recorded what has been spent. Nothing recorded what
// has not been spent yet but must be, which is why "what does Friday cost"
// meant going through a drawer.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listBills, payablesSummary } from "@/lib/core/supplierBills";
import { formatMoney } from "@/lib/format/money";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import {
  approveBillAction,
  buildRunAction,
  payBillAction,
  recordBillAction,
  releaseRunAction,
  voidBillAction,
} from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, { label: string; bg: string; ink: string }> = {
  AWAITING_APPROVAL: { label: "needs approval", bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  APPROVED: { label: "approved to pay", bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  PAID: { label: "paid", bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  VOID: { label: "void", bg: "var(--kb-panel)", ink: "var(--kb-text-dim)" },
};

export default async function PayablesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [summary, bills, suppliers, runs, tenant] = await Promise.all([
    payablesSummary(tenantId),
    listBills(tenantId),
    prisma.party.findMany({
      where: { tenantId, role: { in: ["SUPPLIER", "CUSTOMER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyName: true },
    }),
    prisma.paymentRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 6, include: { bills: { select: { id: true } } } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  const currency = tenant?.currency ?? "ZAR";
  const money = (c: number) => formatMoney(c, currency);
  const today = new Date();

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="What you owe" crumbs={[{ label: "What you owe" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Supplier invoices before they are paid. A bill is money that has not gone yet and has a date by which it must —
        which is what tells you on the 25th what Friday costs. Paying one writes the cost to the books; recording one
        does not.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="kb-card px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">{money(summary.totalCents)}</p>
          <p className="text-xs text-[var(--kb-text-dim)]">
            {summary.suppliers} {summary.suppliers === 1 ? "supplier" : "suppliers"}
          </p>
        </div>
        <div className="kb-card px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Past its date</p>
          <p
            className="mt-1 text-2xl font-semibold"
            style={{ color: summary.lateCents > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
          >
            {money(summary.lateCents)}
          </p>
          <p className="text-xs text-[var(--kb-text-dim)]">
            {summary.lateCents > 0 ? "A supplier stops delivering over this" : "Nothing late"}
          </p>
        </div>
        <div className="kb-card px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Approved, waiting</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--kb-text)]">
            {money(
              bills.filter((b) => b.status === "APPROVED" && !b.paymentRunId).reduce((s, b) => s + (b.amountCents - b.paidCents), 0)
            )}
          </p>
          <p className="text-xs text-[var(--kb-text-dim)]">Ready for a payment run</p>
        </div>
      </div>

      <details className="kb-card mb-5 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--kb-text)]">Record a bill</summary>
        <form action={recordBillAction.bind(null, tenantId)} className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-[var(--kb-text-dim)]">
            Supplier
            <select name="supplierId" className="kb-input mt-1 w-full text-sm">
              <option value="">Not on file — type the name</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName ?? s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Or the name off the invoice
            <input name="supplierName" className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Their invoice number
            <input name="reference" className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Amount
            <input name="amount" required inputMode="decimal" className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Tax on it (leave blank if the invoice does not show it)
            <input name="tax" inputMode="decimal" className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)]">
            Due
            <input type="date" name="dueOn" required className="kb-input mt-1 w-full text-sm" />
          </label>
          <label className="text-xs text-[var(--kb-text-dim)] sm:col-span-2">
            Anything worth noting
            <input name="notes" className="kb-input mt-1 w-full text-sm" />
          </label>
          <div className="flex justify-end sm:col-span-2">
            <SubmitButton pendingText="Recording…">Record it</SubmitButton>
          </div>
        </form>
      </details>

      {summary.ageing.length > 0 && (
        <section className="kb-card mb-5 overflow-hidden p-0">
          <h2 className="px-5 pt-4 text-sm font-semibold text-[var(--kb-text)]">By supplier, by how late</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="px-5 py-2">Supplier</th>
                  {summary.ageing[0].buckets.map((b) => (
                    <th key={b.label} className="px-3 py-2 text-right">
                      {b.label}
                    </th>
                  ))}
                  <th className="px-5 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.ageing.map((row) => (
                  <tr key={row.supplier} className="border-t border-[var(--kb-panel-border)]">
                    <td className="px-5 py-2 text-[var(--kb-text)]">{row.supplier}</td>
                    {row.buckets.map((b) => (
                      <td key={b.label} className="px-3 py-2 text-right tabular-nums text-[var(--kb-text-dim)]">
                        {b.cents > 0 ? money(b.cents) : "—"}
                      </td>
                    ))}
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-[var(--kb-text)]">{money(row.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="kb-card mb-5 p-5">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">Payment runs</h2>
        <form action={buildRunAction.bind(null, tenantId)} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--kb-text-dim)]">
            Everything approved and due by
            <input type="date" name="dueBefore" className="kb-input mt-1 text-sm" />
          </label>
          <SubmitButton pendingText="Gathering…">Build a run</SubmitButton>
        </form>
        {runs.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-[var(--kb-text)]">
                  {run.runOn.toLocaleDateString()} · {run.bills.length} {run.bills.length === 1 ? "bill" : "bills"} ·{" "}
                  {money(run.totalCents)}
                </span>
                {run.status === "RELEASED" ? (
                  <span className="kb-pill text-[10px]" style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}>
                    released {run.releasedAt?.toLocaleDateString()}
                  </span>
                ) : (
                  <form action={releaseRunAction.bind(null, tenantId, run.id)}>
                    <button type="submit" className="kb-pill kb-pill-primary text-xs">
                      The money has gone
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        {bills.length === 0 ? (
          <EmptyState
            title="No supplier bills yet"
            purpose="What you owe, and when — so the cash forecast sees money going out before it goes."
            needs="A supplier invoice and the date it must be paid."
          />
        ) : (
          <ul className="kb-card divide-y divide-[var(--kb-panel-border)]">
            {bills.map((bill) => {
              const tone = TONE[bill.status];
              const outstanding = bill.amountCents - bill.paidCents;
              const late = outstanding > 0 && bill.dueOn < today;
              return (
                <li key={bill.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--kb-text)]">
                      {bill.supplier?.companyName ?? bill.supplier?.name ?? bill.supplierName}
                      {bill.reference ? ` · ${bill.reference}` : ""}
                    </p>
                    <p className="text-xs" style={{ color: late ? "var(--kb-status-danger-ink)" : "var(--kb-text-dim)" }}>
                      Due {bill.dueOn.toLocaleDateString()}
                      {late ? " · past its date" : ""}
                      {bill.paidCents > 0 && outstanding > 0 ? ` · ${money(bill.paidCents)} paid` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">{money(outstanding || bill.amountCents)}</span>
                    <span className="kb-pill text-[10px]" style={{ background: tone.bg, color: tone.ink }}>
                      {tone.label}
                    </span>
                    {bill.status === "AWAITING_APPROVAL" && (
                      <form action={approveBillAction.bind(null, tenantId, bill.id)}>
                        <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                          Approve
                        </button>
                      </form>
                    )}
                    {bill.status === "APPROVED" && (
                      <form action={payBillAction.bind(null, tenantId, bill.id)}>
                        <button type="submit" className="kb-pill kb-pill-primary text-[10px]">
                          Paid
                        </button>
                      </form>
                    )}
                    {bill.status !== "PAID" && bill.status !== "VOID" && (
                      <form action={voidBillAction.bind(null, tenantId, bill.id)}>
                        <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                          Void
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-5 text-xs text-[var(--kb-text-dim)]">
        {summary.summary} What has already gone is under{" "}
        <Link href={`/dashboard/${tenantId}/expenses`} className="underline">
          costs
        </Link>
        .
      </p>
    </div>
  );
}
