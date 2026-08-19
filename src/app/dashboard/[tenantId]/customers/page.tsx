import Link from "next/link";
import { listCustomers } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const niche = nicheConfig(tenant.niche);
  const customers = await listCustomers(tenantId);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">{niche.customerLabel}s</h1>
        <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill kb-pill-primary">
          + New quote
        </Link>
      </div>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">
          No {niche.customerLabel.toLowerCase()}s yet. Run <code>npm run db:seed</code> for
          a worked example, or add one from a new quote.
        </p>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{c.name}</p>
                <p className="text-sm text-[var(--kb-text-dim)]">
                  {c.phone ?? c.email ?? "no contact on file"}
                </p>
              </div>
              <Link
                href={`/dashboard/${tenantId}/customers/${c.id}`}
                className="text-sm text-[var(--kb-accent-a)] hover:underline"
              >
                View history
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
