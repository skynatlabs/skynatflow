// Owner dashboard home — cash position first, per the strategic report's
// "one daily action, not a dashboard" principle (Section 12). Light, airy
// design pass: pastel stat tiles, a big colorful donut of the quote
// pipeline, pill buttons — built to feel playful, not like a chore.

import Link from "next/link";
import { findStaleTransactions } from "@/lib/core/money";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

// Rounded, no decimals — for the big stat-tile numbers specifically, where
// a shorter figure reads cleaner than exact cents and reliably fits the tile.
function moneyCompact(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  });
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#c9cede",
  SENT: "var(--kb-accent-b)",
  ACCEPTED: "var(--kb-tint-mint-ink)",
  PARTIALLY_PAID: "var(--kb-tint-yellow-ink)",
  PAID: "var(--kb-accent-a)",
  DECLINED: "var(--kb-tint-peach-ink)",
  OVERDUE: "#e2445c",
  CANCELLED: "#c9cede",
};

export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const [stale, customerCount, openInvoices, quotes] = await Promise.all([
    findStaleTransactions({ tenantId, staleAfterDays: 3 }),
    prisma.party.count({ where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] } } }),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE", status: { in: ["SENT", "PARTIALLY_PAID"] } },
    }),
    prisma.transaction.findMany({ where: { tenantId, type: "QUOTE" } }),
  ]);

  const staleTotalCents = stale.reduce((sum, t) => sum + t.amountCents, 0);
  const outstandingCents = openInvoices.reduce((sum, t) => sum + t.amountCents, 0);

  // Donut segments from real quote-status counts — a conic-gradient built
  // server-side, no chart library needed for something this simple.
  const statusCounts = quotes.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {});
  const total = quotes.length || 1;
  let cursor = 0;
  const stops = Object.entries(statusCounts).map(([status, count]) => {
    const start = (cursor / total) * 360;
    cursor += count;
    const end = (cursor / total) * 360;
    return `${STATUS_COLORS[status] ?? "#c9cede"} ${start}deg ${end}deg`;
  });
  const donutStyle =
    quotes.length === 0
      ? { background: "var(--kb-panel-border)" }
      : { background: `conic-gradient(${stops.join(", ")})` };

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--kb-text)]">
            Good to see you, {tenant.name} 👋
          </h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Here&apos;s what&apos;s happening across your business right now.
          </p>
        </div>
        <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill kb-pill-primary">
          + New Quote
        </Link>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="kb-tile kb-tint-mint">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
            Money owed to you
          </p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(outstandingCents)}</p>
          <p className="mt-1 text-xs opacity-70">
            {openInvoices.length} open invoice{openInvoices.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="kb-tile kb-tint-peach">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Gone quiet</p>
          <p className="mt-2 truncate text-xl font-extrabold sm:text-2xl">{moneyCompact(staleTotalCents)}</p>
          <p className="mt-1 text-xs opacity-70">
            {stale.length} need{stale.length === 1 ? "s" : ""} a follow-up
          </p>
        </div>

        <div className="kb-tile kb-tint-blue">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Customers</p>
          <p className="mt-2 text-3xl font-extrabold">{customerCount}</p>
          <p className="mt-1 text-xs opacity-70">on file</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="kb-card p-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">Needs your attention</h2>
          {stale.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--kb-text-dim)]">
              Nothing overdue right now — the follow-up engine has it covered. 🎉
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--kb-panel-border)]">
              {stale.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }}
                    >
                      {t.type}
                    </span>
                    <span className="text-[var(--kb-text)]">{t.party.name}</span>
                  </div>
                  <span className="font-semibold text-[var(--kb-text)]">{money(t.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="kb-card flex flex-col items-center p-6">
          <h2 className="self-start text-sm font-semibold text-[var(--kb-text)]">
            Quote pipeline
          </h2>
          <div className="relative mt-4 h-[190px] w-[190px] rounded-full" style={donutStyle}>
            <div
              className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full"
              style={{ background: "var(--kb-panel)" }}
            >
              <span className="text-3xl font-extrabold text-[var(--kb-text)]">{quotes.length}</span>
              <span className="text-xs text-[var(--kb-text-dim)]">total quotes</span>
            </div>
          </div>
          <ul className="mt-5 w-full space-y-2">
            {Object.entries(statusCounts).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-[var(--kb-text-dim)]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: STATUS_COLORS[status] ?? "#c9cede" }}
                  />
                  {status.replace("_", " ")}
                </span>
                <span className="font-semibold text-[var(--kb-text)]">{count}</span>
              </li>
            ))}
            {quotes.length === 0 && (
              <li className="text-xs text-[var(--kb-text-dim)]">No quotes yet.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
