import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { getOpenEntry, getTeamAttendance } from "@/lib/core/attendance";
import { clockInAction, clockOutAction } from "./actions";

function duration(from: Date, to: Date | null) {
  const ms = (to ?? new Date()).getTime() - from.getTime();
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const [open, team] = await Promise.all([
    access.membershipId ? getOpenEntry(tenantId, access.membershipId) : null,
    getTeamAttendance(tenantId),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Attendance</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Clock in/out for remote and field work — no separate app needed.
      </p>

      <div className="kb-card mt-6 p-6 text-center">
        {open ? (
          <>
            <p className="text-sm text-[var(--kb-text-dim)]">
              Clocked in since {open.clockInAt.toLocaleTimeString()} · {duration(open.clockInAt, null)}
            </p>
            <form action={clockOutAction} className="mt-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <button type="submit" className="kb-pill kb-pill-primary">Clock out</button>
            </form>
          </>
        ) : (
          <form action={clockInAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <button type="submit" className="kb-pill kb-pill-primary">Clock in</button>
          </form>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Recent activity</h2>
      <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
        {team.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <div>
              <p className="font-medium text-[var(--kb-text)]">{e.memberName}</p>
              <p className="text-xs text-[var(--kb-text-dim)]">
                {e.clockInAt.toLocaleString()} {e.clockOutAt ? `→ ${e.clockOutAt.toLocaleTimeString()}` : "(still in)"}
              </p>
            </div>
            <span className="text-xs text-[var(--kb-text-dim)]">{duration(e.clockInAt, e.clockOutAt)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
