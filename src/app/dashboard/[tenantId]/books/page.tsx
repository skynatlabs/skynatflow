import { moneyOf } from "@/lib/regions";
import { prisma } from "@/lib/db";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { listClosedPeriods } from "@/lib/core/ledger";
import { ledgerCoverage } from "@/lib/core/ledgerBackfill";
import {
  balanceSheet,
  profitAndLoss,
  trialBalance,
  type ReportSection,
} from "@/lib/core/financialReports";
import {
  backfillAction,
  closePeriodAction,
  reopenPeriodAction,
  startBooksAction,
} from "./actions";

export const dynamic = "force-dynamic";


function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** A headline figure, sized so the number is what you read first. */
function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div className="kb-card px-5 py-4">
      <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">{label}</p>
      <p
        className="mt-1 text-2xl leading-none font-semibold tabular-nums"
        style={{ color: tone ?? "var(--kb-text)" }}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-[11px] text-[var(--kb-text-dim)]">{note}</p>}
    </div>
  );
}

// The formatter comes in as a prop. A component that formats money without
// being told whose it is is a geo-lock waiting to happen.
function SectionTable({ section, money }: { section: ReportSection; money: (cents: number) => string }) {
  if (section.rows.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
        {section.label}
      </h3>
      <table className="mt-1.5 w-full text-sm">
        <tbody>
          {section.rows.map((r) => (
            <tr key={r.accountId} className="border-b border-[var(--kb-panel-border)] last:border-0">
              <td className="py-1.5 text-[var(--kb-text)]">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                {money(r.balanceCents)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-semibold text-[var(--kb-text)]">Total {section.label.toLowerCase()}</td>
            <td className="pt-2 text-right font-semibold tabular-nums text-[var(--kb-text)]">
              {money(section.totalCents)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function BooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { tenantId } = await params;
  // This workspace's own money, never the one the code was written in.
  const money = await moneyOf(tenantId);
  const { year: yearParam } = await searchParams;

  const accountCount = await prisma.account.count({ where: { tenantId } });
  if (accountCount === 0) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">The books</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
          skynat.ai has always known what you invoiced and what you spent. That is not the same as
          knowing whether you made anything — and it cannot be reconciled against a bank statement
          or handed to an accountant. This turns it into real double-entry books.
        </p>
        <div className="kb-card mt-6 px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">Open your books</h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
            You get a small chart of accounts you can rename or extend, and every invoice, payment
            and expense already recorded gets posted into it. Nothing is invented: the books open
            with your real trading in them, not a blank page.
          </p>
          <form action={startBooksAction} className="mt-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <SubmitButton pendingText="Opening…">Open the books</SubmitButton>
          </form>
        </div>
      </main>
    );
  }

  const now = new Date();
  const year = Number(yearParam) || now.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  const [pl, bs, tb, coverage, closed] = await Promise.all([
    profitAndLoss(tenantId, { from, to }),
    balanceSheet(tenantId, to),
    trialBalance(tenantId, to),
    ledgerCoverage(tenantId),
    listClosedPeriods(tenantId),
  ]);

  const profitTone =
    pl.netProfitCents > 0
      ? "var(--kb-tint-mint-ink)"
      : pl.netProfitCents < 0
        ? "var(--kb-tint-peach-ink)"
        : "var(--kb-text)";

  const closedSet = new Set(closed.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`));
  const closableMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }).filter((m) => !closedSet.has(`${m.year}-${String(m.month).padStart(2, "0")}`));

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">The books</h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            {year} · {pl.summary || "Nothing posted for this year yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[year - 1, year, year + 1].map((y) => (
            <a
              key={y}
              href={`?year=${y}`}
              className={`kb-pill text-xs ${y === year ? "kb-pill-primary" : "kb-pill-ghost"}`}
            >
              {y}
            </a>
          ))}
          {/* What the VAT return asks for, in the shape it asks for it. */}
          <a href={`/dashboard/${tenantId}/books/vat-summary?grouping=sars`} className="kb-pill kb-pill-ghost text-xs">
            VAT summary
          </a>
          {/* And the return itself, box by box, for the period being filed. */}
          <a href={`/dashboard/${tenantId}/books/vat`} className="kb-pill kb-pill-ghost text-xs">
            VAT return
          </a>
        </div>
      </div>

      {/* Coverage before figures. A profit number built on half the invoices
          is worse than no number, so the gap is stated before the total. */}
      {!coverage.upToDate && (
        <div
          className="mt-5 rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" }}
        >
          <p>
            {coverage.unpostedInvoices + coverage.unpostedPayments + coverage.unpostedExpenses}{" "}
            things haven&apos;t reached the books yet — the figures below are missing them.
          </p>
          <form action={backfillAction} className="mt-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="Posting…">
              Post them now
            </SubmitButton>
          </form>
        </div>
      )}

      {!tb.balanced && (
        <div
          className="mt-5 rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--kb-tint-peach)", color: "var(--kb-tint-peach-ink)" }}
        >
          The books don&apos;t balance: {money(tb.totalDebitCents)} in debits against{" "}
          {money(tb.totalCreditCents)} in credits. Nothing in the app can produce this, so
          something has written to the database directly.
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Income" value={money(pl.income.totalCents)} />
        <Figure
          label="Gross profit"
          value={money(pl.grossProfitCents)}
          note={pl.grossMarginPercent === null ? undefined : `${pl.grossMarginPercent}% margin`}
        />
        <Figure label="Overheads" value={money(pl.expenses.totalCents)} />
        <Figure
          label={pl.netProfitCents < 0 ? "Loss" : "Net profit"}
          value={money(Math.abs(pl.netProfitCents))}
          tone={profitTone}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="kb-card px-5 py-5">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Profit &amp; loss</h2>
          <p className="text-xs text-[var(--kb-text-dim)]">
            {from.toISOString().slice(0, 10)} to {to.toISOString().slice(0, 10)}
          </p>
          <SectionTable money={money} section={pl.income} />
          <SectionTable money={money} section={pl.costOfSales} />
          <div className="mt-3 flex justify-between border-t border-[var(--kb-panel-border)] pt-2 text-sm font-semibold text-[var(--kb-text)]">
            <span>Gross profit</span>
            <span className="tabular-nums">{money(pl.grossProfitCents)}</span>
          </div>
          <SectionTable money={money} section={pl.expenses} />
          <div className="mt-3 flex justify-between border-t-2 border-[var(--kb-text)] pt-2 text-sm font-semibold text-[var(--kb-text)]">
            <span>{pl.netProfitCents < 0 ? "Loss for the year" : "Net profit"}</span>
            <span className="tabular-nums" style={{ color: profitTone }}>
              {money(Math.abs(pl.netProfitCents))}
            </span>
          </div>
        </section>

        <section className="kb-card px-5 py-5">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Balance sheet</h2>
          <p className="text-xs text-[var(--kb-text-dim)]">
            At {bs.to.toISOString().slice(0, 10)}
          </p>
          <SectionTable money={money} section={bs.assets} />
          <SectionTable money={money} section={bs.liabilities} />
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
              {bs.equity.label}
            </h3>
            <table className="mt-1.5 w-full text-sm">
              <tbody>
                {bs.equity.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-[var(--kb-panel-border)]">
                    <td className="py-1.5 text-[var(--kb-text)]">{r.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                      {money(r.balanceCents)}
                    </td>
                  </tr>
                ))}
                {/* Shown explicitly: a business that has never closed a year
                    would otherwise see a sheet that does not balance and
                    reasonably conclude the software is broken. */}
                <tr className="border-b border-[var(--kb-panel-border)]">
                  <td className="py-1.5 text-[var(--kb-text)]">Profit this year, not yet closed</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                    {money(bs.retainedThisYearCents)}
                  </td>
                </tr>
                <tr>
                  <td className="pt-2 font-semibold text-[var(--kb-text)]">Total</td>
                  <td className="pt-2 text-right font-semibold tabular-nums text-[var(--kb-text)]">
                    {money(bs.totalEquityCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 border-t border-[var(--kb-panel-border)] pt-2 text-xs text-[var(--kb-text-dim)]">
            {bs.balanced
              ? "What you own equals what you owe plus your stake."
              : `Out by ${money(Math.abs(bs.differenceCents))} — something upstream is wrong.`}
          </p>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Trial balance</h2>
        <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
          What a bookkeeper or accountant will ask you for.
        </p>
        <div className="kb-card mt-3 overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--kb-panel-border)] text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="py-1.5 text-left font-medium">Code</th>
                <th className="py-1.5 text-left font-medium">Account</th>
                <th className="py-1.5 text-right font-medium">Debit</th>
                <th className="py-1.5 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.accountId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                  <td className="py-1.5 text-[var(--kb-text-dim)] tabular-nums">{r.code}</td>
                  <td className="py-1.5 text-[var(--kb-text)]">{r.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                    {r.debitBalanceCents ? money(r.debitBalanceCents) : ""}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                    {r.creditBalanceCents ? money(r.creditBalanceCents) : ""}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-[var(--kb-text)]">
                <td colSpan={2} className="pt-2">
                  Total
                </td>
                <td className="pt-2 text-right tabular-nums">{money(tb.totalDebitCents)}</td>
                <td className="pt-2 text-right tabular-nums">{money(tb.totalCreditCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Closing a month. The guardrail that makes raising the agent's
          autonomy a setting rather than an act of courage. */}
      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <div className="kb-card px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">Close a month</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Read the <a href={`/dashboard/${tenantId}/books/month-end`} className="underline">month-end pack</a> first — cash flow, tax to have ready, depreciation, and what stands in the way.
          </p>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Once a month is closed nothing more can be posted into it — not by you, not by the
            agent. That is what makes the figures you have already given someone stay true.
          </p>
          <form action={closePeriodAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <select name="period" className="kb-input text-sm">
              {closableMonths.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {monthLabel(m.year, m.month)}
                </option>
              ))}
            </select>
            <SubmitButton pendingText="Closing…">Close it</SubmitButton>
          </form>
        </div>

        <div className="kb-card px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">Closed months</h2>
          {closed.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--kb-text-dim)]">Nothing closed yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--kb-panel-border)]">
              {closed.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className="text-sm text-[var(--kb-text)]">
                    {monthLabel(p.year, p.month)}
                  </span>
                  <form action={reopenPeriodAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="year" value={p.year} />
                    <input type="hidden" name="month" value={p.month} />
                    <SubmitButton
                      className="kb-pill kb-pill-ghost text-[11px] text-[var(--kb-text-dim)]"
                      pendingText="…"
                    >
                      Reopen
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-[var(--kb-text-dim)]">
            Reopening is deliberately something only a person can do — the agent has no way to
            unlock a closed month.
          </p>
        </div>
      </section>
    </main>
  );
}
