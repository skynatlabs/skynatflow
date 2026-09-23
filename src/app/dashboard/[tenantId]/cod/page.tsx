// Cash on delivery.
//
// The number a depot manager wants at four in the afternoon and cannot get
// from anything else: how much of the business's money is currently in bags
// on the road. It goes at the top.
//
// Underneath, the two costs that never appear in a set of books — parcels
// that needed a second trip, and parcels refused at the door. A 30%
// rejection rate reads as fuel and as a delivery fee charged once for a job
// done three times, and it is the reason the unit economics do not work.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { codPicture, ridersHolding, buyerReliability } from "@/lib/core/cod";
import { openBagAction, assignAction, attemptAction, closeBagAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CodPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [picture, holding, buyers, outstanding, team, currency] = await Promise.all([
    codPicture(tenantId),
    ridersHolding(tenantId),
    buyerReliability(tenantId, {}),
    prisma.deliveryNote.findMany({
      where: { tenantId, status: { in: ["DRAFT", "SENT"] } },
      orderBy: { createdAt: "asc" },
      take: 60,
      include: { party: { select: { name: true } } },
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
      take: 200,
    }),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const unassigned = outstanding.filter((n) => !n.riderMembershipId);
  const onTheRoad = outstanding.filter((n) => n.riderMembershipId);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Cash on delivery</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        A rider&apos;s bag is a till: a float out, everything collected during the run, a count at
        the end and the variance surfaced. A rider is held to what they actually took, never to a
        customer who refused to pay.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Out on the road</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {money(picture.outOnTheRoadCents)}
          </p>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            {picture.ridersOut} rider{picture.ridersOut === 1 ? "" : "s"}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Refused, 30 days</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{
              color: picture.rejectionPercent >= 20 ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
            }}
          >
            {picture.rejectionPercent}%
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Needed a second trip</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {picture.redeliveries}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Came back short</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{
              color: picture.shortSettlementsCents > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
            }}
          >
            {money(picture.shortSettlementsCents)}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Bags open</h2>
      {holding.length === 0 ? (
        <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
          Nobody is out. Open a bag below before handing out parcels.
        </div>
      ) : (
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {holding.map((bag) => (
            <li key={bag.settlementId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--kb-text)]">{bag.riderName}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  float {money(bag.openingFloatCents)} + collected {money(bag.collectedCents)} &middot;{" "}
                  {bag.parcelsDelivered} of {bag.parcelsOut} delivered &middot; out {bag.hoursOpen}h
                </p>
              </div>
              <p className="tabular-nums font-semibold text-[var(--kb-text)]">
                {money(bag.holdingCents)}
              </p>
              <form action={closeBagAction} className="flex items-center gap-2">
                <input type="hidden" name="tenantId" value={tenantId} />
                <input type="hidden" name="settlementId" value={bag.settlementId} />
                <input
                  name="counted"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="counted"
                  required
                  className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-sm"
                />
                <button type="submit" className="kb-pill text-xs">
                  Settle
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {onTheRoad.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Out for delivery</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {onTheRoad.map((note) => (
              <li key={note.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--kb-text)]">{note.party.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {note.number}
                    {note.codAmountCents ? ` · collect ${money(note.codAmountCents)}` : " · prepaid"}
                    {note.attemptCount > 0 && ` · ${note.attemptCount} tr${note.attemptCount === 1 ? "y" : "ies"} already`}
                  </p>
                </div>
                <form action={attemptAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="deliveryNoteId" value={note.id} />
                  <select
                    name="outcome"
                    className="rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-xs"
                  >
                    <option value="DELIVERED">Delivered</option>
                    <option value="REFUSED">Refused</option>
                    <option value="NOT_HOME">Nobody home</option>
                    <option value="WRONG_ADDRESS">Wrong address</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                  <input
                    name="collected"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="collected"
                    defaultValue={note.codAmountCents ? (note.codAmountCents / 100).toFixed(2) : ""}
                    className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-1.5 text-sm"
                  />
                  <button type="submit" className="kb-pill text-xs">
                    Record
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {buyers.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Who takes what they order</h2>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
            This business&apos;s own experience of these customers, worst first, and only where
            there is enough history for it to mean anything. It is not a blacklist and it is never
            shared with anybody else.
          </p>
          <div className="kb-card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--kb-panel-border)] text-left text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
                  <th className="p-3">Customer</th>
                  <th className="p-3 text-right">Landed</th>
                  <th className="p-3 text-right">Refused</th>
                  <th className="p-3 text-right">Trips per parcel</th>
                  <th className="p-3 text-right">Success</th>
                </tr>
              </thead>
              <tbody>
                {buyers.slice(0, 20).map((b) => (
                  <tr key={b.partyId} className="border-b border-[var(--kb-panel-border)] last:border-0">
                    <td className="p-3 text-[var(--kb-text)]">{b.name}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{b.delivered}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">{b.refused}</td>
                    <td className="p-3 text-right tabular-nums text-[var(--kb-text-dim)]">
                      {b.attemptsPerParcel}
                    </td>
                    <td
                      className="p-3 text-right tabular-nums"
                      style={{
                        color: b.successPercent < 60 ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
                      }}
                    >
                      {b.successPercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <form action={openBagAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Open a bag</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Rider</span>
              <select
                name="riderMembershipId"
                required
                className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              >
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name ?? m.user.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Float</span>
              <input
                name="float"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0"
                className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
              />
            </label>
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Open
            </button>
          </div>
        </form>

        {unassigned.length > 0 && holding.length > 0 && (
          <form action={assignAction} className="kb-card p-4">
            <h3 className="text-sm font-semibold text-[var(--kb-text)]">Hand out a parcel</h3>
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="mt-3 grid gap-2">
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Parcel</span>
                <select
                  name="deliveryNoteId"
                  required
                  className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                >
                  {unassigned.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.number} — {n.party.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">Rider</span>
                  <select
                    name="riderMembershipId"
                    required
                    className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                  >
                    {holding.map((h) => (
                      <option key={h.riderMembershipId} value={h.riderMembershipId}>
                        {h.riderName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block font-medium text-[var(--kb-text-dim)]">Collect</span>
                  <input
                    name="codAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="prepaid"
                    className="mt-1 w-24 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                  />
                </label>
                <button type="submit" className="kb-pill text-xs">
                  Hand over
                </button>
              </div>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
