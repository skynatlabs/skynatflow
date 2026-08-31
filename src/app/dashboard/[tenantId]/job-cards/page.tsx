// Job cards — the physical work behind a sale, tracked separately from
// pricing (which stays on the quote/invoice this links to). Built for
// solar/services install crews, per the user's own "job card" term.

import { prisma } from "@/lib/db";
import { listJobCards } from "@/lib/core/jobCards";
import { createJobCardAction, toggleJobCardTaskAction, setJobCardStatusAction, completeJobCardAction } from "./actions";

const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", DONE: "Done" };

export default async function JobCardsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [jobCards, acceptedTransactions, memberships] = await Promise.all([
    listJobCards(tenantId),
    prisma.transaction.findMany({
      where: { tenantId, type: { in: ["QUOTE", "INVOICE"] }, status: { in: ["ACCEPTED", "SENT", "PARTIALLY_PAID"] } },
      include: { party: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Job cards</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        A work order per job — assign it, checklist the steps, mark it done once every step is
        actually ticked off. Linked to the quote/invoice it's the work behind.
      </p>

      <details className="kb-card mt-6 p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--kb-text)]">+ New job card</summary>
        <form action={createJobCardAction} className="mt-4 space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div>
            <label className="block text-xs font-medium text-[var(--kb-text-dim)]">Job (quote/invoice)</label>
            <select name="jobRef" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
              {acceptedTransactions.map((t) => (
                <option key={t.id} value={`${t.id}|${t.partyId}`}>
                  {t.party.name} — {t.type} ({(t.amountCents / 100).toFixed(2)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--kb-text-dim)]">Title</label>
            <input name="title" required placeholder="e.g. Solar panel install" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--kb-text-dim)]">Assign to</label>
              <select name="assignedToId" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                <option value="">Unassigned</option>
                {memberships.map((m) => (
                  <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--kb-text-dim)]">Scheduled for</label>
              <input name="scheduledAt" type="datetime-local" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--kb-text-dim)]">Checklist (one step per line)</label>
            <textarea name="taskLabels" rows={3} placeholder={"Mount panels\nWire inverter\nTest system"} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </div>
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Create job card</button>
        </form>
      </details>

      <section className="mt-6 space-y-4">
        {jobCards.length === 0 ? (
          <div className="kb-card p-8 text-center text-sm text-[var(--kb-text-dim)]">No job cards yet.</div>
        ) : (
          jobCards.map((jc) => {
            const allDone = jc.tasks.length > 0 && jc.tasks.every((t) => t.isDone);
            return (
              <div key={jc.id} className="kb-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--kb-text)]">{jc.title}</p>
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      {jc.party.name}{jc.assignedTo ? ` · ${jc.assignedTo.user.name ?? jc.assignedTo.user.email}` : " · Unassigned"}
                      {jc.scheduledAt ? ` · ${jc.scheduledAt.toLocaleString()}` : ""}
                    </p>
                  </div>
                  <span className="kb-pill kb-pill-ghost text-xs">{STATUS_LABEL[jc.status]}</span>
                </div>

                {jc.tasks.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {jc.tasks.map((task) => (
                      <li key={task.id} className="flex items-center gap-2">
                        <form action={toggleJobCardTaskAction}>
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="taskId" value={task.id} />
                          <button type="submit" className="flex items-center gap-2 text-left text-sm">
                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${task.isDone ? "border-[var(--kb-accent-a)] bg-[var(--kb-accent-a)] text-white" : "border-[var(--kb-panel-border)]"}`}>
                              {task.isDone ? "✓" : ""}
                            </span>
                            <span className={task.isDone ? "text-[var(--kb-text-dim)] line-through" : "text-[var(--kb-text)]"}>{task.label}</span>
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                {jc.status !== "DONE" && (
                  <div className="mt-3 flex gap-2">
                    {jc.status === "SCHEDULED" && (
                      <form action={setJobCardStatusAction}>
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="jobCardId" value={jc.id} />
                        <input type="hidden" name="status" value="IN_PROGRESS" />
                        <button type="submit" className="kb-pill kb-pill-ghost text-xs">Start job</button>
                      </form>
                    )}
                    <form action={completeJobCardAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="jobCardId" value={jc.id} />
                      <button
                        type="submit"
                        disabled={jc.tasks.length > 0 && !allDone}
                        className="kb-pill kb-pill-primary text-xs disabled:opacity-40"
                        title={jc.tasks.length > 0 && !allDone ? "Tick off every checklist item first" : undefined}
                      >
                        Mark done
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
