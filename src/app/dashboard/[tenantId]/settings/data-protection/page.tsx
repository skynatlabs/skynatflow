// POPIA and the GDPR, answered rather than promised.
//
// Both laws ask the same four questions of anybody holding other people's
// information, and almost no small business can answer them — not because
// they are doing anything wrong, but because nobody has ever written it down
// for them. This is the writing-down, generated from what the system actually
// holds, with the part that has to be a person's job named as such.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { BASIS_LABEL, breachSurface, pastRetention, processingRecord } from "@/lib/core/dataProtection";

export const dynamic = "force-dynamic";

export default async function DataProtectionPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);

  if (!can(access.role, "staff:manage")) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
        <h1 className="text-xl font-semibold text-[var(--kb-text)]">Data protection</h1>
        <p className="mt-2 text-sm text-[var(--kb-text-dim)]">
          This is the business&apos;s own record of what it holds about people, so only an owner can open it.
        </p>
      </main>
    );
  }

  const [record, retention, breach] = await Promise.all([processingRecord(tenantId), pastRetention(tenantId), breachSurface(tenantId)]);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">Data protection</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">{record.role}</p>

      {/* ------------------------------------------------- what is held */}
      <section className="kb-card mt-6 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What {record.businessName} holds</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="pb-2 pr-3">What</th>
                <th className="pb-2 pr-3">Why</th>
                <th className="pb-2 pr-3">On what basis</th>
                <th className="pb-2">For how long</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kb-panel-border)]">
              {record.categories.map((category) => (
                <tr key={category.what}>
                  <td className="py-2 pr-3 align-top text-[var(--kb-text)]">{category.what}</td>
                  <td className="py-2 pr-3 align-top text-[var(--kb-text-dim)]">{category.why}</td>
                  <td className="py-2 pr-3 align-top text-[var(--kb-text-dim)]">{BASIS_LABEL[category.basis]}</td>
                  <td className="py-2 align-top text-[var(--kb-text-dim)]">{category.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--kb-text-dim)]">{record.crossBorder}</p>
      </section>

      {/* --------------------------------------------------- held too long */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Held longer than it should be</h2>
        {retention.rows.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">{retention.note}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
              {retention.rows.map((row) => (
                <li key={row.what} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-[var(--kb-text)]">{row.what}</span>
                    <span className="text-sm tabular-nums text-[var(--kb-text)]">
                      {row.count.toLocaleString()} <span className="text-[11px] text-[var(--kb-text-dim)]">older than {row.older}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{row.action}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--kb-text-dim)]">{retention.note}</p>
          </>
        )}
      </section>

      {/* ------------------------------------------------------- a breach */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">If there were a breach</h2>
        <p className="mt-2 text-sm text-[var(--kb-text)]">{breach.sentence}</p>
        <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{breach.duty}</p>
        <ul className="mt-3 grid gap-1 text-xs text-[var(--kb-text-dim)]">
          {breach.notHeld.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------- how it is held */}
      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">How it is kept safe</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          {record.security.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------- your part */}
      <section className="kb-card mt-4 p-4 sm:p-5" style={{ background: "var(--kb-tint-yellow)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What is still yours to do</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text)]">
          {record.yourPart.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
