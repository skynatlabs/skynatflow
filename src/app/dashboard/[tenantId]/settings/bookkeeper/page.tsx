// The books, in the shape the accountant's software wants them.
//
// The point of this screen is to end the argument that keeps a business
// paying for a second subscription: "my accountant only works in Xero". They
// can carry on working in Xero.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { PACKAGES } from "@/lib/export/accounting";
import { ExportBuilder } from "./ExportBuilder";
import { buildExportAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BookkeeperPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  // Defaults to the tax year so far, which is what somebody arriving at this
  // screen almost always wants and is a tedious thing to type twice.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">For your bookkeeper</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The same ledger, written the way their software expects to read it. Nothing here changes your books — it makes a
        file you send on.
      </p>

      <section className="kb-card mt-6 p-4 sm:p-5">
        <ExportBuilder
          tenantId={tenantId}
          packages={PACKAGES}
          defaultFrom={from}
          defaultTo={to}
          buildAction={buildExportAction}
        />
      </section>

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Where the file goes</h2>
        <ul className="mt-3 grid gap-3">
          {PACKAGES.map((pkg) => (
            <li key={pkg.key}>
              <p className="text-sm font-medium text-[var(--kb-text)]">{pkg.label}</p>
              <p className="text-xs text-[var(--kb-text-dim)]">{pkg.how}</p>
              {pkg.liveSync !== "—" && <p className="text-[11px] text-[var(--kb-text-dim)]">{pkg.liveSync}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
          A file rather than a live two-way sync, on purpose. Two systems that both believe they own the chart of accounts
          produce conflicts nobody can settle, and the small business always loses that argument.
        </p>
      </section>
    </main>
  );
}
