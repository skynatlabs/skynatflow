import { prisma } from "@/lib/db";
import { listClaims, getAgingDenials } from "@/lib/core/claims";
import { submitClaimAction, markDeniedAction, markReworkedAction, markPaidAction } from "./actions";
import { Pagination } from "@/components/dashboard/Pagination";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const STATUS_TINT: Record<string, string> = {
  SUBMITTED: "kb-tint-blue",
  PAID: "kb-tint-mint",
  DENIED: "kb-tint-peach",
  REWORKED: "kb-tint-yellow",
};

export default async function ClaimsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));
  const [{ items: claims, pageCount }, agingDenials, invoices] = await Promise.all([
    listClaims(tenantId, page),
    getAgingDenials(tenantId),
    prisma.transaction.findMany({
      where: { tenantId, type: "INVOICE" },
      include: { party: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Insurance claims</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Nothing gets quietly written off — every denied claim stays visible with an aging timer
        until it's actually reworked or resolved.
      </p>

      {agingDenials.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-[var(--kb-tint-peach-ink)]">Needs follow-up</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {agingDenials.map((d) => (
              <li key={d.claimId} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{d.payerName} · {money(d.claimedCents)}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{d.denialReason || "No reason given"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--kb-tint-peach-ink)]">{d.daysAging}d aging</span>
                  <form action={markReworkedAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="claimId" value={d.claimId} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Mark reworked</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">All claims</h2>
      <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
        {claims.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-[var(--kb-text)]">{c.payerName} · {money(c.claimedCents)}</p>
              <p className="text-xs text-[var(--kb-text-dim)]">Submitted {c.submittedAt.toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`kb-tile ${STATUS_TINT[c.status]} !py-1 !px-3 text-[11px] font-semibold`}>{c.status}</span>
              {c.status === "SUBMITTED" && (
                <>
                  <form action={markPaidAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="claimId" value={c.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Paid</button>
                  </form>
                  <form action={markDeniedAction} className="flex items-center gap-1">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="claimId" value={c.id} />
                    <input name="denialReason" placeholder="Reason" className="w-24 rounded-md border border-[var(--kb-panel-border)] bg-white px-2 py-1 text-xs" />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Denied</button>
                  </form>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} />

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Submit a claim</h2>
      <form action={submitClaimAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Invoice</span>
          <select name="transactionId" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>{i.party.name} · {money(i.amountCents)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Payer</span>
          <input name="payerName" required placeholder="Discovery, Bonitas..." className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-[var(--kb-text-dim)]">Claimed (ZAR)</span>
          <input name="claimedRand" type="number" step="0.01" required className="mt-1 w-28 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
        </label>
        <button type="submit" className="kb-pill kb-pill-primary text-xs">Submit</button>
      </form>
    </main>
  );
}
