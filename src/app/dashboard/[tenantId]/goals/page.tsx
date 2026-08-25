import { prisma } from "@/lib/db";
import { listGoals } from "@/lib/core/goals";
import { createGoalAction, updateGoalProgressAction } from "./actions";

const STATUS_TINT: Record<string, string> = {
  ON_TRACK: "kb-tint-mint",
  AT_RISK: "kb-tint-yellow",
  ACHIEVED: "kb-tint-blue",
  MISSED: "kb-tint-peach",
};

export default async function GoalsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [goals, memberships] = await Promise.all([
    listGoals(tenantId),
    prisma.membership.findMany({ where: { tenantId }, include: { user: true } }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Goals</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Company and individual targets, tracked in one place.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {goals.map((g) => (
          <li key={g.id} className={`kb-tile ${STATUS_TINT[g.status]}`}>
            <div className="flex items-center justify-between">
              <p className="font-bold">{g.title}</p>
              <span className="text-[11px] font-semibold uppercase">{g.status.replace("_", " ")}</span>
            </div>
            <p className="mt-1 text-sm opacity-80">
              {g.currentValue} / {g.targetValue} {g.metricLabel}
              {g.dueDate && ` · due ${g.dueDate.toLocaleDateString()}`}
            </p>
            <form action={updateGoalProgressAction} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="goalId" value={g.id} />
              <input
                name="currentValue"
                type="number"
                step="any"
                defaultValue={g.currentValue}
                className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs text-[var(--kb-text)]"
              />
              <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Update progress</button>
            </form>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">New goal</h2>
      <form action={createGoalAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Title</span>
          <input name="title" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Metric</span>
          <input name="metricLabel" required placeholder="Revenue" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Target</span>
          <input name="targetValue" type="number" step="any" required className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Owner (optional)</span>
          <select name="ownerId" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            <option value="">Whole company</option>
            {memberships.map((m) => (
              <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Due (optional)</span>
          <input name="dueDate" type="date" className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">Add goal</button>
      </form>
    </main>
  );
}
