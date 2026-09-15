// The Brief — where the officers report.
//
// This page exists because of a counting problem. The sidebar has grown past
// forty entries, and every officer added to the platform wants a home: a CFO
// page, a COO page, a legal page. Six officers with six inboxes is six places
// to check every morning, which is not a chief financial officer, it is a
// filing cabinet that talks.
//
// So there is one desk. Everything any officer found is ranked against
// everything else, the best four are on it, and the rest is a number. Four is
// not a technical limit — it is the number of decisions somebody running a
// business will actually make before closing the tab, and a brief that
// respects that gets read every day while a complete one gets read once.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Officer } from "@prisma/client";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { currentBrief, approvalQueue, type RankedItem, type QueueItem } from "@/lib/agent/chiefOfStaff";
import { onboardingState } from "@/lib/onboarding/progress";
import { PageHeader } from "../PageHeader";
import { Figure } from "@/components/dashboard/Figure";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { decideObservation } from "./actions";

export const dynamic = "force-dynamic";

// ------------------------------------------------------------------ labels

// Titles, not acronyms. "CFO" is a role somebody recognises; "cfo:overdue-
// debtors" is a dedupe key, and the difference between the two is most of
// what makes this feel like a person reporting rather than a job running.
const OFFICER: Record<Officer, { name: string; title: string; tint: string; ink: string }> = {
  CEO: { name: "CEO", title: "Chief Executive", tint: "var(--kb-tint-violet)", ink: "var(--kb-tint-violet-ink)" },
  CFO: { name: "CFO", title: "Chief Financial Officer", tint: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  COO: { name: "COO", title: "Chief Operating Officer", tint: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  LEGAL: { name: "Legal", title: "Legal Counsel", tint: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
  SALES: { name: "Sales", title: "Sales Consultant", tint: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  EFFICIENCY: { name: "Efficiency", title: "Efficiency Consultant", tint: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  SYSTEM: { name: "Watch", title: "Automatic watch", tint: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
};

// Formatted exactly as the officers write it. The figure under a headline
// that reads "R45 000" must not read "ZAR 45,000" — two spellings of one
// number on one card makes a person wonder whether they are the same number.
// (Workspaces have no currency of their own yet; bank accounts do. When that
// changes, this and the officers' sentences change together.)
function money(cents: number) {
  return `R${Math.abs(cents / 100).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

// `now` is the brief's own timestamp rather than Date.now(), so one render
// reads every date against the same instant and a re-render is idempotent.
function whenDue(date: Date | null, now: Date): string | null {
  if (!date) return null;
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days < -1) return `${Math.abs(days)} days late`;
  if (days === -1) return "1 day late";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 14) return `In ${days} days`;
  return date.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------- page

export default async function BriefPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  // Read together; the desk is only shown once the workspace is known.
  const [tenant, brief, queue, setup] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, arrivalShownAt: true, turnaroundMode: true, onboardedAt: true },
    }),
    currentBrief(tenantId),
    approvalQueue(tenantId),
    onboardingState(tenantId),
  ]);
  if (!tenant) notFound();
  // The first time anyone opens the Brief, the officers introduce themselves.
  if (!tenant.arrivalShownAt) redirect(`/dashboard/${tenantId}/brief/welcome`);

  // Observations already appear on the desk above; showing them again under
  // "waiting on you" would make one list look like two piles of work.
  const waiting = queue.filter((q) => q.kind !== "observation");

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="The Brief"
        crumbs={[{ label: "The Brief" }]}
        actions={
          <span className="flex flex-wrap gap-1">
            <Link href={`/dashboard/${tenantId}/brief/audit`} className="kb-pill kb-pill-ghost text-xs">First audit</Link>
            <Link href={`/dashboard/${tenantId}/settings/officers`} className="kb-pill kb-pill-ghost text-xs">Who reports to you</Link>
          </span>
        }
      />

      {!setup.finished && setup.remaining.length > 0 && (
        <div className="kb-card mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ background: "var(--kb-tint-yellow)" }}>
          <p className="text-sm text-[var(--kb-text)]">
            Finish setting up — {setup.remaining.map((r) => r.label.toLowerCase()).join(", ")}. The officers see more the more they have.
          </p>
          <Link href={`/onboarding/${tenantId}/${setup.step}`} className="kb-pill kb-pill-primary text-xs">
            Carry on
          </Link>
        </div>
      )}

      {tenant.turnaroundMode && (
        <p className="mb-4 rounded-lg px-4 py-2 text-xs font-medium" style={{ background: "var(--kb-tint-peach)", color: "var(--kb-tint-peach-ink)" }}>
          Turnaround mode is on: cash comes first, and everything else waits. Switch it off under Who reports to you.
        </p>
      )}

      {brief.items.length === 0 ? (
        <EmptyDesk tenantId={tenantId} />
      ) : (
        <>
          <section className="kb-card mb-5 px-5 py-4">
            <p className="text-[10px] font-medium tracking-wide uppercase text-[var(--kb-text-dim)]">
              {brief.generatedAt.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h3 className="mt-1 text-lg leading-snug font-semibold text-[var(--kb-text)]">
              {brief.headline}
            </h3>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            {brief.items.map((item, i) => (
              <FindingCard
                key={item.observationId}
                item={item}
                rank={i + 1}
                tenantId={tenantId}
                now={brief.generatedAt}
              />
            ))}
          </div>

          {brief.heldBack > 0 && (
            <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
              {brief.heldBack} smaller {brief.heldBack === 1 ? "thing was" : "things were"} held
              back so this page stays worth reading. They keep their place in the
              queue and come up as these are cleared.
            </p>
          )}
        </>
      )}

      <div id="waiting">{waiting.length > 0 && <WaitingOnYou items={waiting} tenantId={tenantId} />}</div>
    </div>
  );
}

// ------------------------------------------------------------------- parts

function EmptyDesk({ tenantId }: { tenantId: string }) {
  return (
    <EmptyState
      title="Nothing needs you today."
      purpose="Your officers went through the books, the bank, the debtors, the fleet and the deadlines and found nothing worth interrupting you about. A quiet desk is the point — it is what makes a busy one worth reading."
      needs="They read what the business records. The more that goes in — slips, trips, bank statements, renewals — the more they can find."
      action={{ label: "Record a cost", href: `/dashboard/${tenantId}/expenses` }}
    />
  );
}

function FindingCard({
  item,
  rank,
  tenantId,
  now,
}: {
  item: RankedItem;
  rank: number;
  tenantId: string;
  now: Date;
}) {
  const who = OFFICER[item.handedTo ?? item.officer];
  const due = whenDue(item.urgentBy, now);
  const late = item.urgentBy !== null && item.urgentBy.getTime() < now.getTime();
  const decideHere = decideObservation.bind(null, tenantId);

  return (
    <article
      className="kb-card flex flex-col overflow-hidden p-0"
      style={{ borderTop: `3px solid ${who.ink}` }}
    >
      <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="kb-pill text-[10px] font-semibold uppercase"
              style={{ background: who.tint, color: who.ink }}
              title={who.title}
            >
              {who.name}
            </span>
            {/* Two officers arriving at the same place independently is a
                stronger signal than either alone, and the ranking already
                counts it — so it should be visible, not just felt. */}
            {item.alsoNoticedBy.map((o) => (
              <span
                key={o}
                className="kb-pill text-[10px] text-[var(--kb-text-dim)]"
                title={`${OFFICER[o].title} raised this too`}
              >
                + {OFFICER[o].name}
              </span>
            ))}
          </div>
          <span className="text-[10px] tabular-nums text-[var(--kb-text-dim)]">#{rank}</span>
        </div>

        <h3 className="leading-snug font-semibold text-balance text-[var(--kb-text)]">
          {item.headline}
        </h3>

        {item.detail && (
          <p className="text-xs leading-relaxed text-[var(--kb-text-dim)]">{item.detail}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {item.moneyCents !== null && item.moneyCents > 0 && (
            <Figure
              className="font-semibold tabular-nums text-[var(--kb-text)]"
              workings={item.evidence.map((e) => ({ label: e.label, value: e.value }))}
              note={`${item.confidence}% sure. ${item.alsoNoticedBy.length ? `Also raised by ${item.alsoNoticedBy.map((o) => OFFICER[o].name).join(", ")}.` : ""}`}
            >
              {money(item.moneyCents)}
            </Figure>
          )}
          {due && (
            <span
              className="tabular-nums"
              style={{
                color: late ? "var(--kb-tint-peach-ink)" : "var(--kb-text-dim)",
              }}
            >
              {due}
            </span>
          )}
          {/* Confidence is stated rather than hidden. A forecast presented with
              the same certainty as a bank statement is how trust in the whole
              suite gets spent. */}
          <span className="text-[var(--kb-text-dim)]" title="How sure the officer is">
            {item.confidence}% sure
          </span>
        </div>

        {item.evidence.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-[var(--kb-tint-blue)]/35 px-3 py-2 text-[11px]">
            {item.evidence.slice(0, 4).map((e) => (
              <div key={e.label} className="contents">
                <dt className="text-[var(--kb-text-dim)]">{e.label}</dt>
                <dd className="font-medium tabular-nums text-[var(--kb-text)]">{e.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.proposedAction && (
          <p className="text-xs leading-relaxed text-[var(--kb-text)]">
            <span className="font-medium">Proposed: </span>
            {item.proposedAction}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--kb-panel-border)] px-5 py-3">
        <form action={decideHere}>
          <input type="hidden" name="observationId" value={item.observationId} />
          <input type="hidden" name="actioned" value="yes" />
          <button type="submit" className="kb-pill kb-pill-primary text-xs">
            Take it on
          </button>
        </form>
        <form action={decideHere}>
          <input type="hidden" name="observationId" value={item.observationId} />
          <input type="hidden" name="actioned" value="no" />
          <button
            type="submit"
            className="kb-pill kb-pill-ghost text-xs"
            title="Dismissed here stays dismissed for ninety days, unless it gets materially worse."
          >
            Not now
          </button>
        </form>
      </div>
    </article>
  );
}

function WaitingOnYou({ items, tenantId }: { items: QueueItem[]; tenantId: string }) {
  const hrefFor = (q: QueueItem) =>
    q.kind === "draft_message"
      ? `/dashboard/${tenantId}/ai-drafts`
      : `/dashboard/${tenantId}/agent`;

  return (
    <section className="mt-8">
      <h3 className="mb-3 text-sm font-semibold text-[var(--kb-text)]">Waiting on you</h3>
      <div className="kb-card divide-y divide-[var(--kb-panel-border)] p-0">
        {items.map((q) => (
          <Link
            key={`${q.kind}:${q.id}`}
            href={hrefFor(q)}
            className="flex items-start justify-between gap-4 px-5 py-3 transition-colors hover:bg-[var(--kb-tint-blue)]/25"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--kb-text)]">{q.title}</p>
              {q.detail && (
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--kb-text-dim)]">
                  {q.detail}
                </p>
              )}
            </div>
            <span className="shrink-0 text-[10px] whitespace-nowrap text-[var(--kb-text-dim)]">
              {q.createdAt.toISOString().slice(0, 10)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
