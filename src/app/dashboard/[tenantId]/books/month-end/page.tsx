// Month-end — the bookkeeper's pack.
//
// One page for closing a month: what was posted, what the month made, where
// the cash went and why it differs from profit, the tax that is not the
// business's to spend, what has been written down, and the short list of
// things that stand between the month and being closed. Opening the page
// runs the pack — the backfill and the depreciation are idempotent, so
// looking twice changes nothing.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";
import { monthEndPack, nextMonthToClose } from "@/lib/core/bookkeeper";
import { cashFlowStatement } from "@/lib/core/cashFlowStatement";
import { taxProvisions, vatSetAside } from "@/lib/core/taxProvisions";
import { bookValues } from "@/lib/core/depreciation";
import { listAccruals } from "@/lib/core/accruals";
import { PageHeader } from "../../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { accrueAction, deferAction, runDepreciationAction, runMonthEndAction } from "./actions";

export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Flow({ label, lines, total, money }: { label: string; lines: Array<{ label: string; cents: number }>; total: number; money: (c: number) => string }) {
  return (
    <div>
      <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{label}</p>
      <ul className="mt-1 space-y-0.5 text-sm tabular-nums">
        {lines.slice(0, 6).map((l) => (
          <li key={l.label} className="flex justify-between gap-3"><span className="truncate text-[var(--kb-text-dim)]">{l.label}</span><span>{money(l.cents)}</span></li>
        ))}
        {lines.length === 0 && <li className="text-xs text-[var(--kb-text-dim)]">Nothing moved.</li>}
      </ul>
      <p className="mt-1 flex justify-between border-t border-[var(--kb-panel-border)] pt-1 text-sm font-semibold tabular-nums"><span>Total</span><span>{money(total)}</span></p>
    </div>
  );
}

export default async function MonthEndPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const fallback = (await nextMonthToClose(tenantId)) ?? (() => {
    const d = new Date();
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  })();
  const year = Number(sp.y) || fallback.year;
  const month = Number(sp.m) || fallback.month;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const pack = await monthEndPack(tenantId, year, month);
  const [cf, vat, provisions, assets, accruals] = await Promise.all([
    cashFlowStatement(tenantId, { from, to }),
    vatSetAside(tenantId, to),
    taxProvisions(tenantId, to),
    bookValues(tenantId),
    listAccruals(tenantId, 10),
  ]);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const base = `/dashboard/${tenantId}/books/month-end`;
  const today = to.toISOString().slice(0, 10);

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title={`Month-end · ${MONTHS[month - 1]} ${year}`}
        crumbs={[{ label: "The books", href: `/dashboard/${tenantId}/books` }, { label: "Month-end" }]}
        actions={
          <span className="flex gap-1 text-xs">
            <Link href={`${base}?y=${prev.y}&m=${prev.m}`} className="kb-pill kb-pill-ghost !py-1">← {MONTHS[prev.m - 1].slice(0, 3)}</Link>
            <Link href={`${base}?y=${next.y}&m=${next.m}`} className="kb-pill kb-pill-ghost !py-1">{MONTHS[next.m - 1].slice(0, 3)} →</Link>
          </span>
        }
      />

      <section className="kb-card mb-5 px-5 py-4" style={{ borderTop: `3px solid ${pack.readyToClose ? "var(--kb-tint-mint-ink)" : "var(--kb-tint-yellow-ink)"}` }}>
        <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{pack.readyToClose ? "Ready to close" : "Not ready to close"}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--kb-text)]">{pack.summary}</p>
        {pack.blockers.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-[var(--kb-text-dim)]">
            {pack.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={runMonthEndAction.bind(null, tenantId)}>
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="month" value={month} />
            <SubmitButton pendingText="Working…">Do the month&apos;s bookkeeping</SubmitButton>
          </form>
          <p className="text-xs text-[var(--kb-text-dim)]">
            Posts what has not reached the books and charges depreciation — safe to repeat. Closing stays your click, on <Link href={`/dashboard/${tenantId}/books`} className="underline">the books page</Link>.
          </p>
        </div>
      </section>

      <section className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Profit for the month", v: pack.netProfitCents },
          { label: "Cash change", v: pack.cashChangeCents },
          { label: "Tax collected, owed", v: vat.vatOwedCents, note: vat.shortfallCents > 0 ? `${money(vat.shortfallCents)} already spent` : "covered by the bank" },
          { label: "Depreciation posted", v: pack.depreciation.totalCents, note: `${pack.depreciation.posted} asset${pack.depreciation.posted === 1 ? "" : "s"}` },
        ].map((t) => (
          <div key={t.label} className="kb-card px-5 py-4">
            <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: t.v < 0 ? "var(--kb-tint-peach-ink)" : "var(--kb-text)" }}>{money(t.v)}</p>
            {t.note && <p className="text-xs" style={{ color: t.label.startsWith("Tax") && vat.shortfallCents > 0 ? "var(--kb-tint-peach-ink)" : "var(--kb-text-dim)" }}>{t.note}</p>}
          </div>
        ))}
      </section>

      <section className="kb-card mb-5 px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--kb-text)]">Where the cash went</h3>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{cf.summary}</p>
        <div className="mt-3 grid gap-5 md:grid-cols-3">
          <Flow label="Trading" lines={cf.operating} total={cf.operatingCents} money={money} />
          <Flow label="Equipment & vehicles" lines={cf.investing} total={cf.investingCents} money={money} />
          <Flow label="Loans, capital & drawings" lines={cf.financing} total={cf.financingCents} money={money} />
        </div>
        <p className="mt-3 text-xs text-[var(--kb-text-dim)] tabular-nums">Opening {money(cf.openingCents)} → closing {money(cf.closingCents)}</p>
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="kb-card px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Tax to have ready</h3>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{vat.summary}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {provisions.map((p) => (
              <li key={p.kind}>
                <span className="flex justify-between tabular-nums"><span>{p.kind === "INCOME" ? "Income tax" : "Payroll tax"}</span><span className="font-semibold">{money(p.provisionCents)}</span></span>
                <span className="block text-xs text-[var(--kb-text-dim)]">{p.note}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="kb-card px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Assets and what they are worth now</h3>
            <form action={runDepreciationAction.bind(null, tenantId)}>
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="month" value={month} />
              <SubmitButton className="kb-pill kb-pill-ghost !py-1 text-[11px]">Charge {MONTHS[month - 1].slice(0, 3)}</SubmitButton>
            </form>
          </div>
          {assets.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--kb-text-dim)]">No assets with a purchase price. Add one on the assets page and it is written down here each month.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]"><tr><th className="py-1">Asset</th><th className="py-1 text-right">Cost</th><th className="py-1 text-right">Written off</th><th className="py-1 text-right">Book value</th></tr></thead>
                <tbody className="divide-y divide-[var(--kb-panel-border)]">
                  {assets.map((a) => (
                    <tr key={a.assetId}><td className="py-1">{a.name}</td><td className="py-1 text-right">{money(a.costCents)}</td><td className="py-1 text-right">{money(a.writtenOffCents)}</td><td className="py-1 text-right font-semibold">{money(a.bookValueCents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="kb-card px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">A cost that belongs to this month</h3>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Nothing billed yet, but the cost was this month&apos;s. Booked now, reversed on the first of next month so the real bill lands cleanly.</p>
          <form action={accrueAction.bind(null, tenantId)} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="memo" placeholder="What for" className="kb-input text-sm sm:col-span-2" required />
            <input name="amount" type="number" step="0.01" inputMode="decimal" placeholder="Amount" className="kb-input text-sm" required />
            <input name="accountCode" placeholder="Account code, e.g. 5400" defaultValue="5900" className="kb-input text-sm" />
            <input name="on" type="date" defaultValue={today} className="kb-input text-sm" />
            <SubmitButton>Accrue</SubmitButton>
          </form>
        </div>
        <div className="kb-card px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Money received before the work</h3>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">A deposit is not income until the work is done. Moved out of sales now and back in on the day it is earned.</p>
          <form action={deferAction.bind(null, tenantId)} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="memo" placeholder="Which deposit" className="kb-input text-sm sm:col-span-2" required />
            <input name="amount" type="number" step="0.01" inputMode="decimal" placeholder="Amount" className="kb-input text-sm" required />
            <label className="text-xs text-[var(--kb-text-dim)]">Received <input name="on" type="date" defaultValue={today} className="kb-input mt-1 w-full text-sm" /></label>
            <label className="text-xs text-[var(--kb-text-dim)]">Earned on <input name="earnedOn" type="date" className="kb-input mt-1 w-full text-sm" required /></label>
            <SubmitButton>Defer</SubmitButton>
          </form>
          {accruals.length > 0 && (
            <ul className="mt-3 divide-y divide-[var(--kb-panel-border)] text-xs">
              {accruals.slice(0, 6).map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-1"><span className="truncate">{a.memo}</span><span className="tabular-nums text-[var(--kb-text-dim)]">{a.entryDate.toISOString().slice(0, 10)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
