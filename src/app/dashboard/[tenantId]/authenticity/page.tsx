// Is this thing real?
//
// The counterfeit problem here is not handbags. It is seed that does not
// germinate, fertiliser that is mostly sand, and brake pads that are not.
//
// The page leads with the checks that hit nothing, because those are the
// product. A system that only records valid codes cannot see counterfeiting
// at all — a fake carries a code that is not in the database, so the check
// reads as nothing happening.
//
// Locations are shown to about eleven kilometres and never closer. That is
// enough to say there is a problem in an area and not enough to accuse a
// particular shop on the evidence of some failed scans.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/core/catalog";
import { authenticityPicture } from "@/lib/core/authenticity";
import { issueCodesAction, withdrawCodeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AuthenticityPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const [picture, products, counts, recent] = await Promise.all([
    authenticityPicture(tenantId, 30),
    listProducts(tenantId),
    prisma.productSerial.groupBy({
      by: ["itemId"],
      where: { tenantId },
      _count: { _all: true },
    }),
    prisma.productSerialCheck.findMany({
      where: { tenantId },
      orderBy: { checkedAt: "desc" },
      take: 25,
    }),
  ]);

  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Product authentication</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        A code under a scratch panel that a buyer can check. Every check is kept, including the
        ones that hit nothing &mdash; a fake carries a code that is not ours, so the failures are
        the only place counterfeiting is visible at all.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Checks, 30 days</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {picture.checksLast30}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Codes that are not ours</p>
          <p
            className="mt-1 text-xl font-semibold tabular-nums"
            style={{
              color: picture.unknownLast30 > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-text)",
            }}
          >
            {picture.unknownLast30}
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Share of checks</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {picture.unknownPercent}%
          </p>
        </div>
        <div className="kb-card p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Areas of concern</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
            {picture.clusters.length}
          </p>
        </div>
      </div>

      {picture.clusters.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Where they are turning up</h2>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">
            Rounded to about eleven kilometres, deliberately. Enough to send somebody to look;
            never enough to accuse a shop.
          </p>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {picture.clusters.map((c) => (
              <li
                key={`${c.approxLat},${c.approxLng}`}
                className="flex items-center justify-between px-5 py-3"
              >
                <div>
                  <p className="font-medium tabular-nums text-[var(--kb-text)]">
                    {c.approxLat.toFixed(1)}, {c.approxLng.toFixed(1)}
                  </p>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {c.distinctCodes} different codes &middot; last seen{" "}
                    {c.lastSeen.toLocaleDateString()}
                  </p>
                </div>
                <span
                  className="tabular-nums text-sm"
                  style={{ color: "var(--kb-status-danger-ink)" }}
                >
                  {c.unknownChecks} checks
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Recent checks</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {recent.map((check) => (
              <li key={check.id} className="flex items-center justify-between px-5 py-2.5">
                <span className="font-mono text-sm text-[var(--kb-text)]">{check.codeTried}</span>
                <span
                  className="text-xs"
                  style={{
                    color:
                      check.verdict === "unknown" || check.verdict === "voided"
                        ? "var(--kb-status-danger-ink)"
                        : check.verdict === "repeat"
                          ? "var(--kb-status-warn-ink)"
                          : "var(--kb-text-dim)",
                  }}
                >
                  {check.verdict} &middot; {check.checkedAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <form action={issueCodesAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Create codes</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="mt-3 grid gap-2">
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Product</span>
              <select name="itemId" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                {products.map((p) => {
                  const issued = counts.find((c) => c.itemId === p.id)?._count._all ?? 0;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {issued > 0 ? ` — ${issued} codes` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Generate how many</span>
              <input name="generate" type="number" min={0} max={2000} placeholder="500" className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
              <span className="mt-1 block text-[var(--kb-text-dim)]">
                Random, not sequential &mdash; a code somebody can guess the next of makes the
                whole scheme decorative.
              </span>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">
                Or paste codes you already printed
              </span>
              <textarea name="codes" rows={3} className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 font-mono text-sm" />
            </label>
          </div>
          <button type="submit" className="kb-pill kb-pill-primary mt-3 text-xs">Create</button>
        </form>

        <form action={withdrawCodeAction} className="kb-card p-4">
          <h3 className="text-sm font-semibold text-[var(--kb-text)]">Withdraw a code</h3>
          <input type="hidden" name="tenantId" value={tenantId} />
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Anybody who checks it is told to stop using the product and take it back. The reason
            is shown to them.
          </p>
          <div className="mt-3 grid gap-2">
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Code</span>
              <input name="code" required className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 font-mono text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Reason</span>
              <input name="reason" required placeholder="recalled — germination failure" className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
          </div>
          <button type="submit" className="kb-pill mt-3 text-xs">Withdraw</button>
        </form>
      </section>
    </main>
  );
}
