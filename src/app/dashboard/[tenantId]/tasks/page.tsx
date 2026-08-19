// Teamwork/task board — three columns, drag-free (buttons, not drag-drop,
// per "must be easy to use" — no gesture to learn), assignable to anyone
// with a Membership on this tenant. Each column gets its own pastel tint
// so the board reads at a glance without needing to parse text.

import { prisma } from "@/lib/db";
import { listTasks } from "@/lib/core/tasks";
import { createTaskAction, moveTaskAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";

const COLUMNS: {
  status: "TODO" | "IN_PROGRESS" | "DONE";
  label: string;
  next?: "TODO" | "IN_PROGRESS" | "DONE";
  tint: string;
}[] = [
  { status: "TODO", label: "To do", next: "IN_PROGRESS", tint: "kb-tint-blue" },
  { status: "IN_PROGRESS", label: "In progress", next: "DONE", tint: "kb-tint-yellow" },
  { status: "DONE", label: "Done", tint: "kb-tint-mint" },
];

export default async function TasksPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [tasks, memberships] = await Promise.all([
    listTasks(tenantId),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold text-[var(--kb-text)]">Team tasks</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Simple on purpose — a title, who&apos;s doing it, and when it&apos;s done.
      </p>

      <form action={createTaskAction} className="kb-card mt-6 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="flex-1" style={{ minWidth: 180 }}>
          <label className="block text-xs text-[var(--kb-text-dim)]">New task</label>
          <input name="title" required className={inputClass} placeholder="Call back Jane about the quote" />
        </div>
        <div>
          <label className="block text-xs text-[var(--kb-text-dim)]">Assign to</label>
          <select name="assigneeId" className={inputClass}>
            <option value="">Unassigned</option>
            {memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.name ?? m.user.email} ({m.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--kb-text-dim)]">Due</label>
          <input name="dueAt" type="date" className={inputClass} />
        </div>
        <button type="submit" className="kb-pill kb-pill-primary">
          Add
        </button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.status} className={`kb-tile ${col.tint}`}>
            <h2 className="text-xs font-bold uppercase tracking-wide opacity-70">
              {col.label} ({tasks.filter((t) => t.status === col.status).length})
            </h2>
            <ul className="mt-3 space-y-2">
              {tasks
                .filter((t) => t.status === col.status)
                .map((t) => {
                  const assignee = memberships.find((m) => m.id === t.assigneeId);
                  return (
                    <li key={t.id} className="rounded-xl bg-white/70 p-3 text-sm">
                      <p className="text-[var(--kb-text)]">{t.title}</p>
                      <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                        {assignee ? assignee.user.name ?? assignee.user.email : "Unassigned"}
                        {t.dueAt && ` · due ${t.dueAt.toLocaleDateString()}`}
                      </p>
                      {col.next && (
                        <form action={moveTaskAction} className="mt-2">
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="taskId" value={t.id} />
                          <input type="hidden" name="status" value={col.next} />
                          <button type="submit" className="text-xs font-semibold hover:underline">
                            Move to {COLUMNS.find((c) => c.status === col.next)?.label} &rarr;
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              {tasks.filter((t) => t.status === col.status).length === 0 && (
                <li className="text-xs opacity-60">Nothing here.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
