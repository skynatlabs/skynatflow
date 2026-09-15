import { prisma } from "@/lib/db";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import {
  leaveBalances,
  listHolidays,
  listLeaveRequests,
  whoIsAway,
} from "@/lib/core/people";
import { addHolidayAction, decideLeaveAction, requestLeaveAction } from "./actions";

export const dynamic = "force-dynamic";

const KINDS = [
  ["ANNUAL", "Annual"],
  ["SICK", "Sick"],
  ["FAMILY", "Family responsibility"],
  ["PARENTAL", "Parental"],
  ["UNPAID", "Unpaid"],
  ["OTHER", "Other"],
] as const;

function fmt(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function LeavePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const now = new Date();
  const fortnight = new Date(now.getTime() + 14 * 86_400_000);

  const [balances, pending, away, holidays, members] = await Promise.all([
    leaveBalances(tenantId),
    listLeaveRequests(tenantId, { status: "REQUESTED" }),
    whoIsAway(tenantId, now, fortnight),
    listHolidays(tenantId, now.getUTCFullYear()),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Leave</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Requests, balances, and the question this is really here for — who is away, before you
        promise a customer a date.
      </p>

      {/* Who's away leads. It is the read, not the workflow, that people
          actually come here for. */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Away in the next fortnight</h2>
        {away.length === 0 ? (
          <p className="kb-card mt-3 px-5 py-4 text-sm text-[var(--kb-text)]">
            Nobody is booked off. Everyone is available.
          </p>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {away.map((a) => (
              <li
                key={`${a.membershipId}-${a.startOn.toISOString()}`}
                className="flex items-center justify-between px-5 py-3"
              >
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{a.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {a.kind.toLowerCase()} leave
                  </p>
                </div>
                <span className="text-sm text-[var(--kb-text-dim)]">
                  {fmt(a.startOn)} – {fmt(a.endOn)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Waiting on you</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--kb-text)]">
                    {r.membership.user?.name ?? r.membership.user?.email}
                    <span className="font-normal text-[var(--kb-text-dim)]">
                      {" "}
                      — {r.days} day{r.days === 1 ? "" : "s"} {r.kind.toLowerCase()}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {fmt(r.startOn)} – {fmt(r.endOn)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <form action={decideLeaveAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="leaveRequestId" value={r.id} />
                    <input type="hidden" name="approve" value="true" />
                    <SubmitButton pendingText="…">Approve</SubmitButton>
                  </form>
                  <form action={decideLeaveAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="leaveRequestId" value={r.id} />
                    <input type="hidden" name="approve" value="false" />
                    <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="…">
                      Decline
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Balances</h2>
        <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
          Days already gone and days approved but still ahead are counted separately — they mean
          different things when you&apos;re deciding whether to say yes to another request.
        </p>
        <div className="kb-card mt-3 overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--kb-panel-border)] text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
                <th className="py-1.5 text-left font-medium">Who</th>
                <th className="py-1.5 text-right font-medium">Entitled</th>
                <th className="py-1.5 text-right font-medium">Taken</th>
                <th className="py-1.5 text-right font-medium">Booked</th>
                <th className="py-1.5 text-right font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.membershipId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                  <td className="py-1.5 text-[var(--kb-text)]">
                    {b.name}
                    {b.pending > 0 && (
                      <span className="ml-1.5 text-[11px] text-[var(--kb-text-dim)]">
                        {b.pending} waiting
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text-dim)]">
                    {b.entitlementDays}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                    {b.takenDays}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--kb-text)]">
                    {b.bookedDays}
                  </td>
                  <td
                    className="py-1.5 text-right font-semibold tabular-nums"
                    style={{
                      color:
                        b.remainingDays < 0
                          ? "var(--kb-tint-peach-ink)"
                          : "var(--kb-text)",
                    }}
                  >
                    {b.remainingDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <div className="kb-card px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">Book time off</h2>
          <form action={requestLeaveAction} className="mt-3 space-y-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">Who</span>
                <select name="membershipId" className="kb-input mt-1 w-full text-sm">
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user?.name ?? m.user?.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">Kind</span>
                <select name="kind" className="kb-input mt-1 w-full text-sm">
                  {KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">From</span>
                <input type="date" name="startOn" required className="kb-input mt-1 w-full text-sm" />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">To</span>
                <input type="date" name="endOn" required className="kb-input mt-1 w-full text-sm" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Reason, if it helps</span>
              <input name="reason" className="kb-input mt-1 w-full text-sm" />
            </label>
            <p className="text-[11px] text-[var(--kb-text-dim)]">
              Weekends and public holidays are left out of the day count automatically.
            </p>
            <SubmitButton pendingText="Requesting…">Request</SubmitButton>
          </form>
        </div>

        <div className="kb-card px-5 py-5">
          <h2 className="text-base font-semibold text-[var(--kb-text)]">Public holidays</h2>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Days nobody is expected to work, so they don&apos;t come off anyone&apos;s leave.
          </p>
          <form action={addHolidayAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Name</span>
              <input
                name="name"
                required
                placeholder="Heritage Day"
                className="kb-input mt-1 w-40 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Date</span>
              <input type="date" name="onDate" required className="kb-input mt-1 text-sm" />
            </label>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </form>

          {holidays.length > 0 && (
            <ul className="mt-3 divide-y divide-[var(--kb-panel-border)] text-sm">
              {holidays.map((h) => (
                <li key={h.id} className="flex justify-between py-1.5">
                  <span className="text-[var(--kb-text)]">{h.name}</span>
                  <span className="text-[var(--kb-text-dim)]">{iso(h.onDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
