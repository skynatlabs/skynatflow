// The week, and what is on it.
//
// Scheduling was a date on a job card, which is a list rather than a plan.
// Two things turn one into the other: a day put in the order the stops make
// sense in, and a load figure that says whether the day can take another job
// at all — so "can you come Thursday" has an answer that is not a shrug.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { dispatchBoard } from "@/lib/core/dispatch";
import { retainerHealth } from "@/lib/core/maintenance";
import { blockedByChecklist } from "@/lib/core/checklists";
import { jobsRunningOver } from "@/lib/core/jobBudget";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { orderDayAction, raiseVisitsAction, scheduleJobAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { tenantId } = await params;
  const { days: daysParam } = await searchParams;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const span = Math.min(21, Math.max(3, Number(daysParam) || 7));
  const [board, members, retainers, blocked, over] = await Promise.all([
    dispatchBoard({ tenantId, days: span }),
    prisma.membership.findMany({ where: { tenantId }, select: { id: true, user: { select: { name: true, email: true } } } }),
    retainerHealth(tenantId),
    blockedByChecklist(tenantId),
    jobsRunningOver(tenantId),
  ]);

  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="The week"
        crumbs={[{ label: "The week" }]}
        actions={
          <span className="flex flex-wrap gap-1">
            {[7, 14].map((d) => (
              <Link
                key={d}
                href={`/dashboard/${tenantId}/dispatch?days=${d}`}
                className={`kb-pill text-xs ${span === d ? "kb-pill-primary" : "kb-pill-ghost"}`}
              >
                {d} days
              </Link>
            ))}
            {retainers.notYetOnTheBoard > 0 && (
              <form action={raiseVisitsAction.bind(null, tenantId)}>
                <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                  Raise {retainers.notYetOnTheBoard} maintenance {retainers.notYetOnTheBoard === 1 ? "visit" : "visits"}
                </button>
              </form>
            )}
          </span>
        }
      />

      {(over.jobs.length > 0 || blocked.length > 0) && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {over.jobs.length > 0 && (
            <div className="kb-card p-5" style={{ background: "var(--kb-tint-yellow)" }}>
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">Running over</h2>
              <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{over.summary}</p>
            </div>
          )}
          {blocked.length > 0 && (
            <div className="kb-card p-5">
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">Held up by a checklist</h2>
              <ul className="mt-1 space-y-0.5">
                {blocked.slice(0, 4).map((b) => (
                  <li key={b.jobCardId} className="text-xs text-[var(--kb-text-dim)]">
                    {b.title} — {b.outstanding[0]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {board.days.map((day) => (
          <section key={day.date} className="kb-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">
                {new Date(day.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </h2>
              <span
                className="text-xs tabular-nums"
                style={{ color: day.loadPercent > 100 ? "var(--kb-status-danger-ink)" : "var(--kb-text-dim)" }}
              >
                {hours(day.minutesBooked)} / {hours(day.minutesAvailable)}
              </span>
            </div>
            {/* A bar rather than a number alone: an overloaded day should be
                visible from across the room. */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--kb-panel-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, day.loadPercent)}%`,
                  background: day.loadPercent > 100 ? "var(--kb-status-danger-ink)" : "var(--kb-accent-a)",
                }}
              />
            </div>

            {day.jobs.length === 0 ? (
              <p className="mt-3 text-xs text-[var(--kb-text-dim)]">Nothing booked.</p>
            ) : (
              <>
                <ol className="mt-3 space-y-2">
                  {day.jobs.map((job, i) => (
                    <li key={job.id} className="text-sm">
                      <Link href={`/dashboard/${tenantId}/job-cards`} className="text-[var(--kb-text)] hover:underline">
                        <span className="mr-1.5 text-xs text-[var(--kb-text-dim)]">{i + 1}.</span>
                        {job.title}
                      </Link>
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        {job.customer} · {hours(job.estimatedMinutes)}
                        {job.assignedTo ? ` · ${job.assignedTo}` : job.subcontractor ? ` · ${job.subcontractor}` : " · nobody"}
                      </p>
                      {job.blockedBy && (
                        <p className="text-xs" style={{ color: "var(--kb-status-danger-ink)" }}>
                          Cannot start until “{job.blockedBy}” is done
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                {day.jobs.length > 2 && (
                  <form action={orderDayAction.bind(null, tenantId, day.date)} className="mt-3">
                    <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                      Put in order{day.routeKm ? ` · ${day.routeKm} km` : ""}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text)]">No date on it</h2>
        {board.unscheduled.length === 0 ? (
          <EmptyState
            title="Everything has a date"
            purpose="The pile of work with nothing booked, which is the thing a dispatcher most needs to see."
            needs="A job card with no date on it."
          />
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {board.unscheduled.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--kb-text)]">{job.title}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{job.customer}</p>
                </div>
                <form action={scheduleJobAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="jobCardId" value={job.id} />
                  <input type="date" name="date" required className="kb-input text-xs" />
                  <select name="assignedToId" className="kb-input text-xs">
                    <option value="">Nobody yet</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user.name ?? m.user.email}
                      </option>
                    ))}
                  </select>
                  <input name="minutes" type="number" min={15} step={15} placeholder="mins" className="kb-input w-20 text-xs" />
                  <button type="submit" className="kb-pill kb-pill-primary text-[10px]">
                    Book it
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
