import Link from "next/link";
import { listCustomersPaginated } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { createCustomerAction } from "./actions";
import { TrendAreaChart } from "@/components/dashboard/MiniCharts";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-white px-2.5 py-2 text-sm text-[var(--kb-text)]";

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string; add?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam, add } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  const [tenant, { items: customers, total, pageCount }, recentCustomers] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    listCustomersPaginated(tenantId, page),
    prisma.party.findMany({
      where: { tenantId, role: { in: ["CUSTOMER", "PATIENT"] }, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
  ]);
  const niche = nicheConfig(tenant.niche);

  const months: { start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() - i);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    months.push({ start, end });
  }
  const trendData = months.map(({ start, end }) => ({
    label: start.toLocaleDateString(undefined, { month: "short" }),
    value: recentCustomers.filter((c) => c.createdAt >= start && c.createdAt < end).length,
  }));

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--kb-text)]">
          {niche.customerLabel}s <span className="text-sm font-normal text-[var(--kb-text-dim)]">({total})</span>
        </h1>
        <div className="flex gap-2">
          <Link href={`?add=1`} className="kb-pill kb-pill-primary text-xs">
            + Add {niche.customerLabel.toLowerCase()}
          </Link>
          <Link href={`/dashboard/${tenantId}/quotes/new`} className="kb-pill text-xs">
            + New quote
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <TrendAreaChart title={`New ${niche.customerLabel.toLowerCase()}s, last 6 months`} data={trendData} />
      </div>

      {add === "1" && (
        <form action={createCustomerAction} className="kb-card mt-4 grid grid-cols-2 gap-3 p-5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Name *</span>
            <input name="name" required className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Company</span>
            <input name="companyName" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Phone (WhatsApp)</span>
            <input name="phone" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Email</span>
            <input name="email" type="email" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">VAT number</span>
            <input name="vatNumber" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Address</span>
            <input name="addressLine" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">City</span>
            <input name="city" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Postal code</span>
            <input name="postalCode" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Country</span>
            <input name="country" defaultValue="South Africa" className={inputClass} />
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Notes</span>
            <input name="notes" className={inputClass} />
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <Link href="?" className="kb-pill kb-pill-ghost text-xs">
              Cancel
            </Link>
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Save
            </button>
          </div>
        </form>
      )}

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--kb-text-dim)]">
          No {niche.customerLabel.toLowerCase()}s yet. Run <code>npm run db:seed</code> for
          a worked example, or add one above.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {customers.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/${tenantId}/customers/${c.id}`}
              className="kb-tile kb-tint-blue transition-transform hover:-translate-y-0.5"
            >
              <p className="truncate font-semibold">{c.name}</p>
              <p className="mt-1 truncate text-xs opacity-70">{c.companyName ?? " "}</p>
              <p className="mt-3 truncate text-xs opacity-70">{c.phone ?? c.email ?? "no contact on file"}</p>
              <p className="mt-3 text-xs font-semibold text-[var(--kb-accent-a)]">View history &rarr;</p>
            </Link>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link
            href={`?page=${page - 1}`}
            aria-disabled={page <= 1}
            className={`kb-pill kb-pill-ghost text-xs ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            &larr; Prev
          </Link>
          <span className="text-[var(--kb-text-dim)]">
            Page {page} of {pageCount}
          </span>
          <Link
            href={`?page=${page + 1}`}
            aria-disabled={page >= pageCount}
            className={`kb-pill kb-pill-ghost text-xs ${page >= pageCount ? "pointer-events-none opacity-40" : ""}`}
          >
            Next &rarr;
          </Link>
        </div>
      )}
    </main>
  );
}
