// The roster.
//
// Gaps first. A roster's failure mode is not a bad plan, it is a shift
// nobody noticed was empty until the client phoned, and a page that leads
// with a calendar hides exactly that.
//
// Sign-ons that could not be placed at the site sit below, with the distance
// and the reason, and are deliberately never called a ghost-worker report.
// Every one of those distances has an innocent version — a pin recorded from
// the wrong side of a wall, a phone with no fix in a basement — and software
// should not end somebody's job on a number it cannot explain.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import {
  listWorkSites,
  listShifts,
  unfilledShifts,
  labourForecast,
  signOnsToCheck,
  shiftAdherence,
} from "@/lib/core/workforce";
import { saveSiteAction, saveShiftAction, deleteShiftAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RosterPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const now = new Date();
  const to = new Date(now.getTime() + 14 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [sites, shifts, gaps, forecast, flags, adherence, team, currency] = await Promise.all([
    listWorkSites(tenantId),
    listShifts({ tenantId, from: now, to }),
    unfilledShifts(tenantId, 14),
    labourForecast({ tenantId, from: now, to }),
    signOnsToCheck(tenantId, 7),
    shiftAdherence({ tenantId, from: monthAgo, to: now }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
      take: 200,
    }),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const nameOf = new Map(team.map((m) => [m.id, m.user.name ?? m.user.email]));
  const when = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Roster</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Who is where, for the next fortnight. A sign-on from a phone at the site is checked
        against the site&apos;s pin, which is the difference between a roster and a payroll
        control.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Shifts to come</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{forecast.shifts}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Nobody on them</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{ color: gaps.length > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)" }}
          >
            {gaps.length}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Hours rostered</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{forecast.hours}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">What it will cost</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {money(forecast.costCents)}
          </p>
          {forecast.shiftsWithoutRate > 0 && (
            <p className="mt-1 text-xs" style={{ color: "var(--kb-status-warn-ink)" }}>
              {forecast.shiftsWithoutRate} with no rate — this is a floor
            </p>
          )}
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Nobody on them</h2>
      {gaps.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          Every shift in the next fortnight has somebody on it.
        </div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {gaps.map((gap) => (
            <li key={gap.shiftId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">
                  {gap.siteName ?? "No site"} {gap.role && <span className="text-xs">· {gap.role}</span>}
                </p>
                <p className="text-xs text-[var(--kb-text-dim)]">{when(gap.startsAt)}</p>
              </div>
              <span
                className="text-sm tabular-nums"
                style={{ color: gap.hoursUntil < 48 ? "var(--kb-status-danger-ink)" : "var(--kb-text-dim)" }}
              >
                in {gap.hoursUntil}h
              </span>
            </li>
          ))}
        </ul>
      )}

      {flags.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Sign-ons worth a look</h2>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
            These could not be placed at the site. That is not proof of anything &mdash; each row
            says why it could not be confirmed, and every one of those reasons has an innocent
            version.
          </p>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {flags.slice(0, 20).map((flag) => (
              <li key={flag.timeEntryId} className="px-5 py-3">
                <p className="font-medium text-[var(--kb-text)]">
                  {flag.memberName}
                  {flag.siteName && (
                    <span className="ml-2 text-xs text-[var(--kb-text-dim)]">{flag.siteName}</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  {when(flag.clockInAt)} &middot; {flag.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shifts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Next fortnight</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {shifts.slice(0, 60).map((shift) => (
              <li key={shift.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--kb-text)]">
                    {shift.membershipId ? nameOf.get(shift.membershipId) ?? "Someone" : "— open —"}
                    {shift.role && (
                      <span className="ml-2 text-xs text-[var(--kb-text-dim)]">{shift.role}</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {when(shift.startsAt)} &rarr; {when(shift.endsAt)}
                    {shift.workSite && ` · ${shift.workSite.name}`}
                  </p>
                </div>
                <form action={deleteShiftAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <button type="submit" className="kb-pill text-xs">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {adherence.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Turned up, last 30 days</h2>
          <div className="kb-card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="p-3">Person</th>
                  <th className="p-3 text-right">Booked</th>
                  <th className="p-3 text-right">Signed on</th>
                  <th className="p-3 text-right">Confirmed at site</th>
                  <th className="p-3 text-right">Missed</th>
                </tr>
              </thead>
              <tbody>
                {adherence.map((row) => (
                  <tr key={row.membershipId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 text-[var(--kb-text)]">{row.name}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.shifts}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.signedOn}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">{row.confirmedAtSite}</td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{ color: row.missed > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text-dim)" }}
                    >
                      {row.missed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <form action={saveShiftAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Add a shift</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Starts</span>
              <input name="startsAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Ends</span>
              <input name="endsAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Site</span>
              <select name="workSiteId" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                <option value="">None</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Person</span>
              <select name="membershipId" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                <option value="">Leave open</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>{m.user.name ?? m.user.email}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Role</span>
              <input name="role" placeholder="guard" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Rate per hour</span>
              <input name="ratePerHour" type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
          </div>
          <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">Add shift</button>
        </form>

        <form action={saveSiteAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Add a site</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
              <input name="name" required placeholder="Main gate" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Latitude</span>
              <input name="lat" type="number" step="0.000001" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Longitude</span>
              <input name="lng" type="number" step="0.000001" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Fence (metres)</span>
              <input name="radiusMetres" type="number" min={50} defaultValue={150} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">How to find it</span>
              <input name="landmark" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
          </div>
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            The fence will not go below 50m. A tighter one flags honest people on ordinary phones.
          </p>
          <button type="submit" className="kb-pill mt-3 text-xs">Add site</button>
        </form>
      </section>
    </main>
  );
}
