import Link from "next/link";
import { listCustomersPaginated } from "@/lib/core/parties";
import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { createCustomerAction } from "./actions";

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
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const niche = nicheConfig(tenant.niche);
  const { items: customers, total, pageCount } = await listCustomersPaginated(tenantId, page);

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
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{c.name}</p>
                <p className="text-sm text-[var(--kb-text-dim)]">
                  {c.companyName ? `${c.companyName} · ` : ""}
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
