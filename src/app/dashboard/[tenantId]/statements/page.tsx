import Link from "next/link";
import { prisma } from "@/lib/db";
import { customerBalance } from "@/lib/core/money";

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

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Statements</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every customer's running account balance — every invoice against every payment they've made.
      </p>

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {withBalance.map((c) => (
          <li key={c.id}>
            <Link
              href={`/dashboard/${tenantId}/statements/${c.id}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-black/[0.02]"
            >
              <span className="text-sm font-medium text-[var(--kb-text)]">{c.name}</span>
              <span className={`text-sm font-semibold ${c.balance > 0 ? "text-[var(--kb-tint-peach-ink)]" : "text-[var(--kb-text)]"}`}>
                {money(c.balance)}
              </span>
            </Link>
          </li>
        ))}
        {withBalance.length === 0 && (
          <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">
            No customer currently owes a balance.
          </li>
        )}
      </ul>
    </main>
  );
}
