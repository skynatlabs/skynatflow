import Link from "next/link";
import { prisma } from "@/lib/db";
import { customerBalance } from "@/lib/core/money";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default async function StatementsIndexPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const customers = await prisma.party.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  });

  const balances = await Promise.all(
    customers.map(async (c) => ({ ...c, balance: await customerBalance(tenantId, c.id) }))
  );
  const withBalance = balances.filter((c) => c.balance !== 0);

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
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Statements</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every customer's running account balance — every invoice against every payment they've made.
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
          {withBalance.map((c) => (
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
    </main>
  );
}
