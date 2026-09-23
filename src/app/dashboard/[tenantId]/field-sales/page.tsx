// The field day.
//
// Today's calls first, because that is the only thing a rep opens this for.
// Overdue shops come before route-day shops and better shops before worse
// ones, so a day that runs short runs short on the least important calls
// rather than on whichever ones happened to be last in the list.
//
// The landmark line is printed on every row. Most outlets here have no
// street address that means anything, and "after the blue mosque, third
// gate" is how the call actually gets made.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listCustomers } from "@/lib/core/parties";
import {
  todaysCalls,
  listRoutes,
  listOutlets,
  coverage,
  outletsGoneQuiet,
} from "@/lib/core/outlets";
import { saveOutletAction, saveRouteAction, logVisitAction } from "./actions";

export const dynamic = "force-dynamic";

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function FieldSalesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [calls, routes, outlets, report, quiet, customers, team] = await Promise.all([
    todaysCalls({ tenantId }),
    listRoutes(tenantId),
    listOutlets(tenantId),
    coverage(tenantId, 30),
    outletsGoneQuiet(tenantId),
    listCustomers(tenantId),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, role: true, user: { select: { name: true, email: true } } },
      take: 200,
    }),
  ]);

  const onMap = new Set(outlets.map((o) => o.partyId));
  const notYetMapped = customers.filter((c) => !onMap.has(c.id) && c.name !== "Walk-in customer");

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Field sales</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        The shops due today, and whether the calls are actually being made. A visit recorded from
        a phone at the door is checked against the shop&apos;s pin; one recorded from this page is
        not, and says so.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Due today</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">{calls.length}</p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Shops on the map</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {report.outletsActive}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Covered in 30 days</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {report.coveragePercent}%
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Stopped ordering</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{ color: quiet.length > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text)" }}
          >
            {quiet.length}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Today</h2>
      {calls.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          Nothing due. Give a shop a visit cadence or put it on a route with a day, and it will
          appear here.
        </div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {calls.map((call) => (
            <li key={call.outletId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--kb-text)]">
                  {call.name}
                  {call.tier && (
                    <span className="ml-2 text-xs text-[var(--kb-text-dim)]">{call.tier}</span>
                  )}
                  {call.overdue && (
                    <span className="ml-2 text-xs" style={{ color: "var(--kb-status-warn-ink)" }}>
                      overdue
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {call.landmark ?? call.channel ?? "no directions recorded"}
                  {call.daysSinceVisit !== null && ` · last seen ${call.daysSinceVisit} days ago`}
                  {call.daysSinceVisit === null && " · never visited"}
                </p>
              </div>
              <form action={logVisitAction} className="flex items-center gap-2">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="outletId" value={call.outletId} />
                <select
                  name="outcome"
                  className="rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-xs"
                >
                  <option value="ORDER">Ordered</option>
                  <option value="NO_ORDER">No order</option>
                  <option value="CLOSED">Closed</option>
                  <option value="NOT_FOUND">Not found</option>
                </select>
                <button type="submit" className="kb-pill text-xs">
                  Log
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {report.rows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Reps, last 30 days</h2>
          <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">
            Strike rate is visits that ended in an order. A rep measured on visits will produce
            visits.
          </p>
          <div className="kb-card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="p-3">Rep</th>
                  <th className="p-3 text-right">Visits</th>
                  <th className="p-3 text-right">Orders</th>
                  <th className="p-3 text-right">Strike rate</th>
                  <th className="p-3 text-right">Not placed at the shop</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.membershipId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 text-[var(--kb-text)]">{row.name}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.visits}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{row.orders}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text)]">
                      {row.strikeRatePercent}%
                    </td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{
                        color: row.unverified > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text-dim)",
                      }}
                    >
                      {row.unverified}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--kb-text-dim)]">
            A visit that could not be placed at the shop is a flag, not an accusation. Pins get
            recorded from the wrong side of a road and a shop inside a building may have no
            signal at all.
          </p>
        </section>
      )}

      {quiet.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Stopped ordering</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {quiet.slice(0, 20).map((q) => (
              <li key={q.outletId} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{q.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {q.channel ?? "unclassified"} ·{" "}
                    {q.daysSinceOrder === null
                      ? "never ordered"
                      : `last order ${q.daysSinceOrder} days ago`}
                    {q.daysSinceVisit !== null && ` · visited ${q.daysSinceVisit} days ago`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <form action={saveRouteAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Add a journey plan</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
              <input
                name="name"
                required
                placeholder="Monday — Orlando East"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Day</span>
              <select
                name="dayOfWeek"
                className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                <option value="">No fixed day</option>
                {DAYS.slice(1).map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Rep</span>
              <select
                name="membershipId"
                className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name ?? m.user.email}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="kb-pill text-xs">
              Add
            </button>
          </div>
          {routes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-[var(--kb-text-dim)]">
              {routes.map((r) => (
                <li key={r.id}>
                  {r.name} &middot; {r.dayOfWeek ? DAYS[r.dayOfWeek] : "no fixed day"} &middot;{" "}
                  {r._count.outlets} shop{r._count.outlets === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          )}
        </form>

        <form action={saveOutletAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Put a shop on the map</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              <span className="block font-medium text-[var(--kb-text-dim)]">Customer</span>
              <select
                name="partyId"
                required
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                {[...notYetMapped, ...outlets.map((o) => ({ id: o.partyId, name: o.party.name }))].map(
                  (c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Channel</span>
              <input
                name="channel"
                placeholder="spaza"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Grade</span>
              <input
                name="tier"
                placeholder="A"
                maxLength={4}
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="block font-medium text-[var(--kb-text-dim)]">
                How somebody finds it
              </span>
              <input
                name="landmark"
                placeholder="after the blue mosque, third gate"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Visit every (days)</span>
              <input
                name="visitFrequencyDays"
                type="number"
                min={1}
                placeholder="7"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Route</span>
              <select
                name="routeId"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                <option value="">None</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Latitude</span>
              <input
                name="lat"
                type="number"
                step="0.000001"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Longitude</span>
              <input
                name="lng"
                type="number"
                step="0.000001"
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
          </div>
          <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">
            Save shop
          </button>
        </form>
      </section>
    </main>
  );
}
