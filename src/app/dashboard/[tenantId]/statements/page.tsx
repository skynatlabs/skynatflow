import Link from "next/link";
import { prisma } from "@/lib/db";
import { customerBalances } from "@/lib/core/money";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";
import { Pagination } from "@/components/dashboard/Pagination";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const PAGE_SIZE = 48;

export default async function StatementsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam } = await searchParams;
  // Every customer's balance in one statement, so nobody is left off the
  // list for coming late in the alphabet.
  const balances = await customerBalances(tenantId);
  const owingIds = [...balances].filter(([, cents]) => cents !== 0).map(([id]) => id);
  const parties = owingIds.length
    ? await prisma.party.findMany({ where: { tenantId, id: { in: owingIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const withBalance = parties.map((p) => ({ ...p, balance: balances.get(p.id) ?? 0 }));

  const pageCount = Math.max(1, Math.ceil(withBalance.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number(pageParam) || 1));
  const shown = withBalance.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const barData = withBalance
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 8)
    .map((c) => ({
      name: c.name,
      value: Math.round(c.balance / 100),
      color: "var(--kb-tint-peach-ink)",
    }));

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Statements</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every customer&apos;s running account balance — every invoice against every payment they&apos;ve made.
      </p>

      {barData.length > 0 && (
        <div className="mt-6">
          <BreakdownBarChart title="Top balances owed (ZAR)" data={barData} />
        </div>
      )}

      {withBalance.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">No customer currently owes a balance.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shown.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/${tenantId}/statements/${c.id}`}
              className={`kb-tile transition-transform hover:-translate-y-0.5 ${c.balance > 0 ? "kb-tint-peach" : "kb-tint-mint"}`}
            >
              <p className="truncate font-semibold">{c.name}</p>
              <p className="mt-2 text-xl font-extrabold">{money(c.balance)}</p>
            </Link>
          ))}
        </div>
      )}
      <Pagination page={page} pageCount={pageCount} />
    </main>
  );
}
