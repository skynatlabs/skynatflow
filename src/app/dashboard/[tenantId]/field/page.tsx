// Field mode.
//
// One thumb, bright sunlight, a bar of signal that comes and goes. Today's
// work and nothing else, each job one tap from the two or three things that
// actually happen to it. Big targets, high contrast, no navigation rail —
// everything that belongs on a desk is deliberately absent.

import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { directionsTo, todayInTheField } from "@/lib/core/fieldMode";
import { fieldAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FieldPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  if (!access.membershipId) notFound();

  const { jobs, queued, stuck, greeting } = await todayInTheField({ tenantId, membershipId: access.membershipId });

  return (
    <div className="min-h-screen pb-24" data-field-mode>
      <header className="sticky top-0 z-10 border-b border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-4 py-3">
        <p className="text-lg font-semibold text-[var(--kb-text)]">{greeting}</p>
        {(queued > 0 || stuck > 0) && (
          <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
            {queued > 0 && `${queued} waiting to go up.`} {stuck > 0 && `${stuck} stuck — somebody at the office must look.`}
          </p>
        )}
      </header>

      {jobs.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--kb-text-dim)]">Nothing on. Anything the office adds will appear here.</p>
      ) : (
        <ul className="grid gap-3 p-3">
          {jobs.map((job) => {
            const directions = directionsTo(job);
            return (
              <li key={job.id} className="kb-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-[var(--kb-text)]">{job.title}</span>
                  {job.scheduledAt && (
                    <span className="text-sm tabular-nums text-[var(--kb-text-dim)]">
                      {job.scheduledAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">{job.customer}</p>
                {job.where && <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">{job.where}</p>}

                {job.checklistOutstanding > 0 && (
                  <p className="mt-2 text-xs text-[var(--kb-tint-amber-ink)]">
                    {job.checklistOutstanding} {job.checklistOutstanding === 1 ? "thing" : "things"} on the checklist before this can be closed.
                  </p>
                )}

                {/* Big targets. A person on a ladder gets one tap, not a menu. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {job.actions.map((action) => {
                    if (action.key === "call" && job.phone) {
                      return (
                        <a key={action.key} href={`tel:${job.phone}`} className="kb-pill kb-pill-ghost px-5 py-3 text-sm">
                          {action.label}
                        </a>
                      );
                    }
                    if (action.key === "photo") {
                      return (
                        <a key={action.key} href={`/dashboard/${tenantId}/expenses?jobCardId=${job.id}`} className="kb-pill kb-pill-ghost px-5 py-3 text-sm">
                          {action.label}
                        </a>
                      );
                    }
                    return (
                      <form key={action.key} action={fieldAction}>
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="jobCardId" value={job.id} />
                        <input type="hidden" name="action" value={action.key} />
                        <button
                          type="submit"
                          className={`kb-pill px-5 py-3 text-sm ${action.key === "done" ? "kb-pill-primary" : "kb-pill-ghost"}`}
                        >
                          {action.label}
                        </button>
                      </form>
                    );
                  })}

                  {directions && (
                    <a href={directions} target="_blank" rel="noopener noreferrer" className="kb-pill kb-pill-ghost px-5 py-3 text-sm">
                      Directions
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-4 pb-6 text-center text-[11px] text-[var(--kb-text-dim)]">
        Everything tapped here is saved on this phone first, so it survives a tunnel. It goes up the moment there is signal.
      </p>
    </div>
  );
}
