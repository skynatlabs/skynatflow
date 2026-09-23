// Casual pay.
//
// For the people a payroll system has no row for: farm labour hired for a
// week, guards on a daily rate, packers paid by the crate. They have no
// login, no email and often no bank account, and today they are paid in cash
// off a clipboard nobody keeps.
//
// The page is ordered by the sequence the work actually goes through —
// logged, approved, paid — because that sequence IS the control. The person
// writing up the clipboard and the person handing out money are usually the
// same person, and an approval step is the only thing standing between that
// arrangement and a worker who does not exist.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { listFieldWorkers, whatIsOwed, casualLabourCost } from "@/lib/core/casualPay";
import { saveWorkerAction, logWorkAction, approveWorkAction, markPaidAction } from "./actions";

export const dynamic = "force-dynamic";

const UNIT_WORD: Record<string, string> = { DAILY: "days", PIECE: "pieces", HOURLY: "hours" };

export default async function CasualPayPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);

  const [workers, owed, cost, pending, currency] = await Promise.all([
    listFieldWorkers(tenantId),
    whatIsOwed(tenantId),
    casualLabourCost({ tenantId, from, to: now }),
    prisma.workLog.findMany({
      where: { tenantId, status: "LOGGED" },
      orderBy: { workedOn: "desc" },
      take: 100,
      include: { fieldWorker: { select: { name: true, payKind: true } } },
    }),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const today = now.toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Casual pay</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        People who work here and have no login. Work is logged against the day it was
        <em> done</em>, priced at the rate in force that day, and has to be approved before
        anybody can be paid. Nothing here moves money &mdash; it records who was owed what, and
        when it was handed over.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Waiting to be paid</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {money(owed.totalCents)}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Awaiting approval</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{
              color: cost.awaitingApprovalCents > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text)",
            }}
          >
            {money(cost.awaitingApprovalCents)}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Cost, last 30 days</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {money(cost.amountCents)}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">People on file</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{workers.length}</p>
        </div>
      </div>

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Waiting for approval</h2>
          <form action={approveWorkAction} className="kb-card mt-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <ul className="divide-y divide-[var(--kb-panel-border)]">
              {pending.map((log) => (
                <li key={log.id} className="flex items-center gap-3 px-5 py-2.5">
                  <input type="checkbox" name="workLogId" value={log.id} defaultChecked />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--kb-text)]">{log.fieldWorker.name}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {log.workedOn.toLocaleDateString()} &middot; {log.units}{" "}
                      {UNIT_WORD[log.fieldWorker.payKind]}
                      {log.note && ` · ${log.note}`}
                    </p>
                  </div>
                  <p className="tabular-nums text-sm text-[var(--kb-text)]">{money(log.amountCents)}</p>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--kb-panel-border)] p-3">
              <button type="submit" className="kb-pill kb-pill-primary text-xs">
                Approve ticked
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Approved and unpaid</h2>
        {owed.rows.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">{owed.summary}</div>
        ) : (
          <form action={markPaidAction} className="kb-card mt-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <ul className="divide-y divide-[var(--kb-panel-border)]">
              {owed.rows.map((row) => (
                <li key={row.fieldWorkerId} className="flex items-center gap-3 px-5 py-3">
                  {row.logIds.map((id) => (
                    <input key={id} type="hidden" name="workLogId" value={id} />
                  ))}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--kb-text)]">{row.name}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {row.days} day{row.days === 1 ? "" : "s"} &middot; pay to{" "}
                      {row.payoutNumber ?? row.phone ?? "no number on file"}
                    </p>
                  </div>
                  <p className="tabular-nums font-semibold text-[var(--kb-text)]">
                    {money(row.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-[var(--kb-panel-border)] p-3">
              <p className="text-sm tabular-nums text-[var(--kb-text)]">
                Total {money(owed.totalCents)}
              </p>
              <button type="submit" className="kb-pill text-xs">
                Mark all as paid
              </button>
            </div>
          </form>
        )}
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
          Marking as paid records that money was handed over. Pay it wherever you actually pay
          &mdash; this is the record, not the rail.
        </p>
      </section>

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        {workers.length > 0 && (
          <form action={logWorkAction} className="kb-card p-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Log a day&apos;s work</h3>
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs sm:col-span-2">
                <span className="block font-medium text-[var(--kb-text-dim)]">Who</span>
                <select name="fieldWorkerId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — {money(w.rateCents)} per {UNIT_WORD[w.payKind].slice(0, -1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Day worked</span>
                <input name="workedOn" type="date" required defaultValue={today} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">How many</span>
                <input name="units" type="number" step="0.01" min="0.01" defaultValue={1} required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
              <label className="text-xs sm:col-span-2">
                <span className="block font-medium text-[var(--kb-text-dim)]">Note</span>
                <input name="note" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              </label>
            </div>
            <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">Log it</button>
          </form>
        )}

        <form action={saveWorkerAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Add somebody</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
              <input name="name" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Phone</span>
              <input name="phone" inputMode="tel" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Paid into</span>
              <input name="payoutNumber" placeholder="wallet number" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Paid by</span>
              <select name="payKind" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                <option value="DAILY">the day</option>
                <option value="PIECE">the piece</option>
                <option value="HOURLY">the hour</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Rate</span>
              <input name="rate" type="number" step="0.01" min="0" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="block font-medium text-[var(--kb-text-dim)]">ID number</span>
              <input name="idNumber" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              <span className="mt-1 block text-[var(--kb-text-dim)]">
                Optional, and it is what settles a dispute about who was paid.
              </span>
            </label>
          </div>
          <button type="submit" className="kb-pill mt-3 text-xs">Add</button>
        </form>
      </section>
    </main>
  );
}
