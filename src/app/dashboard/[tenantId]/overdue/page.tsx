// Who to chase, and what to say.
//
// This used to be a list of late invoices with a late-fee button on each,
// which is data rather than a decision. Two things were missing and both of
// them are the difference between a list somebody works through and a list
// somebody closes: it chased people who were paying exactly as agreed, and it
// had no idea what the last message said, so the fourth reminder read exactly
// like the first.
//
// Now it is the ladder. Each row knows which rung it is on, what has already
// been sent, how that customer normally behaves, and — where it applies — the
// reason it is being skipped.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { chaseList, draftChase, ladderEffect, LADDER } from "@/lib/core/collectionsLadder";
import { formatMoney } from "@/lib/format/money";
import { PageHeader } from "../PageHeader";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";
import { Pagination } from "@/components/dashboard/Pagination";
import { applyLateFeeAction, recordChaseAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TONE_STYLE: Record<string, { bg: string; ink: string }> = {
  gentle: { bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  firm: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  final: { bg: "var(--kb-status-danger)", ink: "var(--kb-status-danger-ink)" },
};

export default async function OverduePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string; draft?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam, draft: draftFor } = await searchParams;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [candidates, effect, tenant] = await Promise.all([
    chaseList(tenantId),
    ladderEffect(tenantId),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, currency: true } }),
  ]);
  const money = (c: number) => formatMoney(c, tenant.currency);

  const chaseable = candidates.filter((c) => !c.skip);
  const onPlan = candidates.filter((c) => c.skip);
  const totalOwed = chaseable.reduce((s, c) => s + c.outstandingCents, 0);

  const pageCount = Math.max(1, Math.ceil(chaseable.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number(pageParam) || 1));
  const shown = chaseable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buckets = [
    { name: "0–7 days", test: (d: number) => d <= 7, color: "#f0a3ac" },
    { name: "8–30 days", test: (d: number) => d > 7 && d <= 30, color: "#e2445c" },
    { name: "Over 30", test: (d: number) => d > 30, color: "#a3223c" },
  ];
  const barData = buckets.map((b) => ({
    name: b.name,
    value: Math.round(chaseable.filter((c) => b.test(c.daysLate)).reduce((s, c) => s + c.outstandingCents, 0) / 100),
    color: b.color,
  }));

  // The one being drafted, if any — kept server-side so the wording is the
  // same text the agent would send rather than a second implementation.
  const drafting = draftFor ? chaseable.find((c) => c.transactionId === draftFor) : undefined;
  const portalToken = drafting
    ? (await prisma.party.findUnique({ where: { id: drafting.partyId }, select: { portalToken: true } }))?.portalToken
    : null;
  const draft =
    drafting && drafting.rung
      ? draftChase({
          candidate: drafting,
          businessName: tenant.name,
          currency: tenant.currency,
          portalUrl: portalToken ? `${process.env.NEXT_PUBLIC_APP_URL || "https://skynatflow.com"}/portal/${portalToken}` : null,
        })
      : null;

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Who to chase" crumbs={[{ label: "Who to chase" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        {money(totalOwed)} outstanding across {chaseable.length} {chaseable.length === 1 ? "invoice" : "invoices"}. The
        ladder climbs one rung at a time and stops the moment money lands. {effect.summary}
      </p>

      {chaseable.length > 0 && (
        <div className="mb-5">
          <BreakdownBarChart title="What is late, by how long" data={barData} />
        </div>
      )}

      {draft && drafting && (
        <section className="kb-card mb-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--kb-text)]">
              {drafting.customer} · {LADDER.find((r) => r.step === draft.step)?.label}
            </h2>
            <Link href={`/dashboard/${tenantId}/overdue`} className="kb-pill kb-pill-ghost text-[10px]">
              Close
            </Link>
          </div>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{drafting.rung?.intent}</p>
          <pre className="mt-3 rounded-xl border border-[var(--kb-panel-border)] p-3 text-sm whitespace-pre-wrap text-[var(--kb-text)]">
            {draft.body}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {drafting.phone && (
              <a
                href={`https://wa.me/${drafting.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(draft.body)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="kb-pill kb-pill-primary text-xs"
              >
                Send on WhatsApp
              </a>
            )}
            {drafting.email && (
              <a
                href={`mailto:${drafting.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                className="kb-pill kb-pill-ghost text-xs"
              >
                Send by email
              </a>
            )}
            <form action={recordChaseAction.bind(null, tenantId)} className="flex items-center gap-2">
              <input type="hidden" name="invoiceId" value={drafting.transactionId} />
              <input type="hidden" name="step" value={draft.step} />
              <input type="hidden" name="tone" value={draft.tone} />
              <input type="hidden" name="body" value={draft.body} />
              <select name="channel" className="kb-input text-xs">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="call">Phone call</option>
                <option value="letter">Letter</option>
              </select>
              <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                It has gone
              </button>
            </form>
          </div>
          <p className="mt-2 text-[11px] text-[var(--kb-text-dim)]">
            Recording it is what moves this invoice up the ladder, so the next message is not this one again.
          </p>
        </section>
      )}

      {chaseable.length === 0 ? (
        <div className="kb-card p-8 text-center text-sm text-[var(--kb-text-dim)]">
          Nothing to chase. {onPlan.length > 0 ? `${onPlan.length} on a payment plan and up to date.` : ""}
        </div>
      ) : (
        <ul className="kb-card divide-y divide-[var(--kb-panel-border)]">
          {shown.map((c) => {
            const style = c.rung ? TONE_STYLE[c.rung.tone] : null;
            return (
              <li key={c.transactionId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--kb-text)]">
                    <Link href={`/dashboard/${tenantId}/customers/${c.partyId}`} className="hover:underline">
                      {c.customer}
                    </Link>
                    {c.number ? <span className="ml-2 text-xs font-normal text-[var(--kb-text-dim)]">{c.number}</span> : null}
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {money(c.outstandingCents)} · {c.daysLate} {c.daysLate === 1 ? "day" : "days"} late
                    {c.attemptsSoFar > 0
                      ? ` · chased ${c.attemptsSoFar}×, last ${c.lastAttemptAt?.toLocaleDateString()}`
                      : " · never chased"}
                    {c.history.usuallyOnTime ? " · usually pays on time" : ""}
                  </p>
                </div>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {c.rung && style && (
                    <>
                      <span className="kb-pill text-[10px]" style={{ background: style.bg, color: style.ink }}>
                        {c.rung.label}
                      </span>
                      <Link
                        href={`/dashboard/${tenantId}/overdue?draft=${c.transactionId}`}
                        className="kb-pill kb-pill-primary text-xs"
                      >
                        Write it
                      </Link>
                    </>
                  )}
                  {!c.rung && <span className="text-xs text-[var(--kb-text-dim)]">Too soon for the next rung</span>}
                  <form action={applyLateFeeAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="invoiceId" value={c.transactionId} />
                    <input type="hidden" name="feePercent" value="5" />
                    <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                      + 5% late fee
                    </button>
                  </form>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageCount={pageCount} />

      {onPlan.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">Paying as agreed</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Past the invoice date but on a plan and up to date. Chasing these is how a business insults its
            best-behaved debtor.
          </p>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {onPlan.map((c) => (
              <li key={c.transactionId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="text-sm text-[var(--kb-text)]">
                  {c.customer}
                  {c.number ? ` · ${c.number}` : ""}
                </span>
                <span className="text-xs text-[var(--kb-text-dim)]">{c.skip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
