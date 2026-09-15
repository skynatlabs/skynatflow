// The arrival — six executives starting on Monday.
//
// Each introduces itself by what it found in this business's own data, not
// by a feature tour. Opening the page sets all six to work; what they found
// is on the cards within the minute. An officer with nothing yet says what
// it needs, which is the most useful thing it can say on day one.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { runArrival } from "@/lib/agent/arrival";
import { formatMoney } from "@/lib/core/currency";
import { BRAND } from "@/lib/brand";
import { PageHeader } from "../../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { finishArrivalAction } from "./actions";

export const dynamic = "force-dynamic";

const TINT: Record<string, string> = {
  CEO: "var(--kb-tint-violet-ink)",
  CFO: "var(--kb-tint-mint-ink)",
  COO: "var(--kb-tint-blue-ink)",
  LEGAL: "var(--kb-tint-peach-ink)",
  SALES: "var(--kb-tint-yellow-ink)",
  EFFICIENCY: "var(--kb-accent-a)",
};

export default async function WelcomePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, currency: true } });
  if (!tenant) notFound();
  const money = (c: number) => formatMoney(c, tenant.currency);

  const intros = await runArrival(tenantId);
  const found = intros.filter((i) => i.finding);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title={`Your officers have started`} crumbs={[{ label: "The Brief", href: `/dashboard/${tenantId}/brief` }, { label: "Welcome" }]} />

      <section className="kb-card mb-5 px-5 py-4">
        <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">{BRAND} · {tenant.name}</p>
        <h2 className="mt-1 text-lg font-semibold text-balance text-[var(--kb-text)]">
          {found.length > 0
            ? `Six officers went through ${tenant.name}'s records. ${found.length} of them already found something.`
            : `Six officers went through ${tenant.name}'s records. It is early — here is what each of them needs to start.`}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--kb-text-dim)]">
          From here they work every day. Nothing reaches a customer without you, no money moves without you, and what they find lands on one page — The Brief — ranked by what it is worth.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {intros.map((i) => (
          <article key={i.officer} className="kb-card flex flex-col p-0" style={{ borderTop: `3px solid ${TINT[i.officer]}` }}>
            <div className="flex flex-1 flex-col gap-2 px-5 pt-4 pb-4">
              <p className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: TINT[i.officer] }}>{i.name}</p>
              <p className="text-xs leading-relaxed text-[var(--kb-text-dim)]">{i.role}</p>
              {i.watches && <p className="text-xs leading-relaxed text-[var(--kb-text)]"><span className="font-medium">In your trade I watch: </span>{i.watches}</p>}
              <div className="mt-2 rounded-md bg-[var(--kb-tint-blue)]/35 px-3 py-2">
                {i.finding ? (
                  <>
                    <p className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">What I found</p>
                    <p className="mt-0.5 text-sm font-medium leading-snug text-[var(--kb-text)]">{i.finding.headline}</p>
                    {i.finding.moneyCents ? <p className="mt-1 text-xs tabular-nums text-[var(--kb-text-dim)]">{money(i.finding.moneyCents)} · {i.finding.confidence}% sure</p> : null}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">What I need to start</p>
                    <p className="mt-0.5 text-sm leading-snug text-[var(--kb-text)]">{i.needs}</p>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action={finishArrivalAction.bind(null, tenantId)}>
          <SubmitButton pendingText="Opening…">Go to The Brief</SubmitButton>
        </form>
        <Link href={`/dashboard/${tenantId}/brief/audit`} className="kb-pill kb-pill-ghost text-xs">Read the first audit</Link>
        <Link href={`/dashboard/${tenantId}/settings/officers`} className="text-xs text-[var(--kb-text-dim)] underline">Decide how far each may go</Link>
      </div>
    </div>
  );
}
