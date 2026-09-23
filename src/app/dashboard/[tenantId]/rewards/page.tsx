// Rewards.
//
// Two things a retailer actually wants from a loyalty scheme, and the page
// is ordered by which is worth more: who has stopped coming (reachable, on a
// number the business already holds) sits above who spends the most, because
// the second list is people already walking through the door.
//
// The liability is shown on the same screen as the membership count on
// purpose. Every rewards product in the world reports members; a business
// also needs to know what it will owe when they all come back at once.

import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import { listCustomers } from "@/lib/core/parties";
import {
  getLoyaltyProgram,
  loyaltySummary,
  topMembers,
  lapsedMembers,
} from "@/lib/core/loyalty";
import { saveRewardsProgramAction, enrolMemberAction, adjustPointsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RewardsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [program, summary, best, lapsed, customers, currency] = await Promise.all([
    getLoyaltyProgram(tenantId),
    loyaltySummary(tenantId),
    topMembers(tenantId, 15),
    lapsedMembers(tenantId, 60, 15),
    listCustomers(tenantId),
    tenantCurrency(tenantId),
  ]);

  const money = (cents: number) => formatMoney(Math.round(cents), currency);
  const members = customers.filter((c) => c.name !== "Walk-in customer");

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Rewards</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Points earn themselves at the till. A customer with a phone number on their record is
        enrolled on their first sale, so nobody has to ask a queue of four people whether they
        would like to join.
      </p>

      {!program && (
        <div className="kb-card mt-6 p-5">
          <p className="text-sm text-[var(--kb-text)]">
            No rewards programme yet. Set the rates below and it starts earning on the next sale.
          </p>
        </div>
      )}

      {program && (
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">Members</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {summary.members}
            </p>
          </div>
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">Points outstanding</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {summary.pointsOutstanding}
            </p>
          </div>
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">What that would cost</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {money(summary.liabilityCents)}
            </p>
          </div>
          <div className="kb-card p-4">
            <p className="text-xs text-[var(--kb-text-dim)]">Gone quiet</p>
            <p
              className="mt-1 text-xl font-semibold tabular-nums"
              style={{ color: summary.lapsed > 0 ? "var(--kb-status-warn-ink)" : "var(--kb-text)" }}
            >
              {summary.lapsed}
            </p>
          </div>
        </div>
      )}

      {/* The more valuable of the two lists goes first. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Not been back in two months</h2>
        <p className="mt-0.5 text-sm text-[var(--kb-text-dim)]">
          Customers who used to buy and have stopped. They have not churned quietly — they have
          gone somewhere else, and you already have their number.
        </p>
        {lapsed.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            Nobody has gone quiet yet.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {lapsed.map((m) => (
              <li key={m.partyId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{m.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {m.phone ?? "no number"} &middot; spent {money(m.lifetimeSpendCents)} &middot;{" "}
                    {m.daysSinceLastActivity} days ago
                  </p>
                </div>
                <span className="text-sm tabular-nums text-[var(--kb-text-dim)]">
                  {m.pointsBalance} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Best customers</h2>
        {best.length === 0 ? (
          <div className="kb-card mt-3 p-5 text-sm text-[var(--kb-text-dim)]">
            No members yet. The first sale to a customer with a phone number enrols them.
          </div>
        ) : (
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {best.map((m) => (
              <li key={m.partyId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{m.name}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {m.phone ?? "no number"} &middot; spent {money(m.lifetimeSpendCents)}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-[var(--kb-text)]">{m.pointsBalance} pts</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">The programme</h2>
        <form action={saveRewardsProgramAction} className="kb-card mt-3 grid gap-4 p-5 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={tenantId} />

          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">What it is called</span>
            <input
              name="name"
              defaultValue={program?.name ?? "Rewards"}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>

          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">
              Points earned per {currency} spent
            </span>
            <input
              name="earnPointsPerUnit"
              type="number"
              min={0}
              defaultValue={program?.earnPointsPerUnit ?? 1}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>

          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">
              What one point is worth, in cents
            </span>
            <input
              name="redeemCentsPerPoint"
              type="number"
              min={1}
              defaultValue={program?.redeemCentsPerPoint ?? 10}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>

          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">
              Smallest redemption allowed
            </span>
            <input
              name="minRedeemPoints"
              type="number"
              min={0}
              defaultValue={program?.minRedeemPoints ?? 50}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
          </label>

          <label className="text-xs sm:col-span-2">
            <span className="block font-medium text-[var(--kb-text-dim)]">
              Points go stale after this many days of no activity
            </span>
            <input
              name="expireAfterDays"
              type="number"
              min={30}
              placeholder="leave empty so points never expire"
              defaultValue={program?.expireAfterDays ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            />
            <span className="mt-1 block text-[var(--kb-text-dim)]">
              Expiring points somebody earned is a decision worth making deliberately. Empty is the
              honest default.
            </span>
          </label>

          <label className="flex items-center gap-2 text-xs text-[var(--kb-text)]">
            <input type="checkbox" name="isActive" defaultChecked={program?.isActive ?? true} />
            Programme is running
          </label>

          <label className="flex items-center gap-2 text-xs text-[var(--kb-text)]">
            <input type="checkbox" name="autoEnrol" defaultChecked={program?.autoEnrol ?? true} />
            Enrol customers automatically at the till
          </label>

          <div className="sm:col-span-2">
            <button type="submit" className="kb-pill kb-pill-primary text-xs">
              Save programme
            </button>
          </div>
        </form>
      </section>

      {members.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">By hand</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <form action={enrolMemberAction} className="kb-card flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="tenantId" value={tenantId} />
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Sign somebody up</span>
                <select
                  name="partyId"
                  required
                  className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                >
                  {members.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="kb-pill text-xs">
                Enrol
              </button>
            </form>

            <form action={adjustPointsAction} className="kb-card flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="tenantId" value={tenantId} />
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Adjust points</span>
                <select
                  name="partyId"
                  required
                  className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                >
                  {members.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-medium text-[var(--kb-text-dim)]">Points</span>
                <input
                  name="points"
                  type="number"
                  required
                  placeholder="-50"
                  className="mt-1 w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                />
              </label>
              <label className="text-xs flex-1">
                <span className="block font-medium text-[var(--kb-text-dim)]">Reason</span>
                <input
                  name="reason"
                  required
                  placeholder="goodwill after a wrong order"
                  className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
                />
              </label>
              <button type="submit" className="kb-pill text-xs">
                Apply
              </button>
            </form>
          </div>
        </section>
      )}

      <p className="mt-8 text-xs text-[var(--kb-text-dim)]">
        <Link href={`/dashboard/${tenantId}/pos`} className="underline">
          Point of sale
        </Link>{" "}
        earns points automatically on every sale with a named customer.
      </p>
    </main>
  );
}
