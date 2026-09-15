// What the officers know about one thing.
//
// The record page's shared panel: everything any officer has observed about
// this customer, vehicle or document, open or decided, with the verbs that
// apply to it. Rendered on every record page so a person looking at a thing
// sees what the business thinks about it without opening six desks.

import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/core/currency";

const OFFICER_NAME: Record<string, string> = {
  CEO: "CEO", CFO: "CFO", COO: "COO", LEGAL: "Legal", SALES: "Sales", EFFICIENCY: "Efficiency", SYSTEM: "Watch",
};

export interface RecordAction {
  label: string;
  href: string;
}

export async function RecordPanel({
  tenantId,
  subjectId,
  actions,
  facts = [],
}: {
  tenantId: string;
  subjectId: string;
  /** The verbs that apply to this thing. */
  actions: RecordAction[];
  /** Headline figures about it, already formatted. */
  facts?: Array<{ label: string; value: string; tone?: "bad" | "good" }>;
}) {
  const [tenant, observations] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.observation.findMany({
      where: { tenantId, subjectId, status: { in: ["OPEN", "RAISED", "ACTIONED", "DISMISSED"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, officer: true, handedTo: true, headline: true, status: true, moneyCents: true, createdAt: true, decisionNote: true },
    }),
  ]);
  const currency = tenant?.currency ?? "ZAR";

  return (
    <section className="kb-card mt-6 px-5 py-4">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <Link key={a.label} href={a.href} className="kb-pill kb-pill-ghost !py-1 text-xs">{a.label}</Link>
        ))}
      </div>

      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">{f.label}</dt>
              <dd className="text-sm font-semibold tabular-nums" style={{ color: f.tone === "bad" ? "var(--kb-tint-peach-ink)" : f.tone === "good" ? "var(--kb-tint-mint-ink)" : "var(--kb-text)" }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <h2 className="mt-4 text-xs font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">What the officers noticed</h2>
      {observations.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">Nothing yet. When an officer finds something about this, it appears here as well as on the Brief.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--kb-panel-border)] text-sm">
          {observations.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="kb-pill mr-2 !py-0.5 text-[10px]">{OFFICER_NAME[o.handedTo ?? o.officer]}</span>
                {o.headline}
                {o.status === "DISMISSED" && <span className="block text-[11px] text-[var(--kb-text-dim)]">Set aside{o.decisionNote ? ` — ${o.decisionNote}` : ""}</span>}
                {o.status === "ACTIONED" && <span className="block text-[11px] text-[var(--kb-tint-mint-ink)]">Taken on</span>}
              </span>
              <span className="shrink-0 text-right text-[11px] text-[var(--kb-text-dim)]">
                {o.moneyCents ? <span className="block tabular-nums text-[var(--kb-text)]">{formatMoney(o.moneyCents, currency)}</span> : null}
                {o.createdAt.toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
