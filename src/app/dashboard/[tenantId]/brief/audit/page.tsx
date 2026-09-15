// The first audit — the report a consultant would charge for.
//
// Leakage, work that did not pay, compliance exposure, contracts renewing,
// and money in other people's hands, read in one pass from what the business
// already records. Each section says what it needs when it has too little to
// say anything.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { firstAudit } from "@/lib/agent/arrival";
import { formatMoney } from "@/lib/core/currency";
import { PageHeader } from "../../PageHeader";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true, name: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const audit = await firstAudit(tenantId);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="The first audit" crumbs={[{ label: "The Brief", href: `/dashboard/${tenantId}/brief` }, { label: "Audit" }]} />

      <section className="kb-card mb-5 px-5 py-4">
        <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{tenant.name} · {audit.generatedAt.toISOString().slice(0, 10)}</p>
        <h2 className="mt-1 text-lg font-semibold text-balance text-[var(--kb-text)]">{audit.headline}</h2>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {audit.sections.map((s) => (
          <section key={s.key} className="kb-card px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--kb-text)]">{s.title}</h3>
              {s.cents > 0 && <span className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">{money(s.cents)}</span>}
            </div>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{s.summary}</p>
            {s.lines.length > 0 && (
              <ul className="mt-3 divide-y divide-[var(--kb-panel-border)] text-sm">
                {s.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                    <span className="min-w-0 text-[var(--kb-text)]">{l.label}</span>
                    <span className="shrink-0 text-right text-xs tabular-nums text-[var(--kb-text-dim)]">{l.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p className="mt-6 text-xs text-[var(--kb-text-dim)]">
        Everything here is also on <Link href={`/dashboard/${tenantId}/brief`} className="underline">The Brief</Link> as the officers raise it, ranked by what it is worth.
      </p>
    </div>
  );
}
