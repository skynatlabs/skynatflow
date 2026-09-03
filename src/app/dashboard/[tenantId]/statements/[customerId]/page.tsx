import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Pagination } from "@/components/dashboard/Pagination";

const STATEMENT_PAGE_SIZE = 50;

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

function ledgerEffect(type: string, amountCents: number) {
  if (type === "PAYMENT") return -amountCents;
  return amountCents; // INVOICE and REFUND both add to the balance owed
}

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; customerId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId, customerId } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const party = await prisma.party.findUnique({ where: { id: customerId } });
  if (!party || party.tenantId !== tenantId) notFound();

  const where = { tenantId, partyId: customerId, type: { in: ["INVOICE" as const, "PAYMENT" as const, "REFUND" as const] } };
  const skip = (page - 1) * STATEMENT_PAGE_SIZE;

  const [priorRows, transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: skip,
      select: { type: true, amountCents: true },
    }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take: STATEMENT_PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / STATEMENT_PAGE_SIZE));

  let running = priorRows.reduce((sum, t) => sum + ledgerEffect(t.type, t.amountCents), 0);
  const rows = transactions.map((t) => {
    running += ledgerEffect(t.type, t.amountCents);
    return { ...t, running };
  });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href={`/dashboard/${tenantId}/statements`} className="text-xs text-[var(--kb-text-dim)] hover:underline">
        &larr; All statements
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--kb-text)]">Statement — {party.name}</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        {party.email ?? party.phone ?? ""}
      </p>

      <div className="kb-card mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--kb-panel-border)] text-xs uppercase text-[var(--kb-text-dim)]">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-[var(--kb-panel-border)] last:border-0">
                <td className="px-4 py-2.5 text-[var(--kb-text-dim)]">{t.createdAt.toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-[var(--kb-text)]">
                  {t.type === "INVOICE" ? (
                    <Link href={`/dashboard/${tenantId}/invoices/${t.id}`} className="hover:underline">
                      Invoice
                    </Link>
                  ) : (
                    t.type
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--kb-text)]">
                  {t.type === "INVOICE" ? "+" : "-"}
                  {money(t.amountCents)}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-[var(--kb-text)]">
                  {money(t.running)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--kb-text-dim)]">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} />
    </main>
  );
}
