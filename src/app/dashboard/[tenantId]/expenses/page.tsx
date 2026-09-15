// Expenses — every rand, recorded.
//
// The capture form is the point of the page: a slip photographed at the pump
// and read by the machine, tagged to the vehicle or job while somebody still
// knows which, split business-or-personal at the moment of spend. Below it,
// the two questions a person still has to answer: is this the same cost that
// arrived by another route, and does this one get approved.

import { notFound } from "next/navigation";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listExpenses, spendSplit, possibleDuplicates } from "@/lib/core/expenses";
import { formatMoney, currencySymbol } from "@/lib/core/currency";
import {
  submitExpenseAction,
  readSlipAction,
  approveExpenseAction,
  rejectExpenseAction,
  classifyExpenseAction,
  markDuplicateAction,
  keepBothAction,
} from "./actions";
import { CaptureForm } from "./CaptureForm";
import { Pagination } from "@/components/dashboard/Pagination";
import { PageHeader } from "../PageHeader";

export const dynamic = "force-dynamic";

const STATUS_TINT: Record<string, string> = {
  PENDING: "kb-tint-yellow",
  APPROVED: "kb-tint-mint",
  REJECTED: "kb-tint-peach",
  DUPLICATE: "kb-tint-violet",
};

const SOURCE_LABEL: Record<string, string> = {
  DESKTOP: "typed",
  CAMERA: "photographed",
  UPLOAD: "uploaded",
  EMAIL: "from email",
  BANK_FEED: "from the bank",
  CARD_STATEMENT: "from a card statement",
  STAFF_APP: "from the app",
  IMPORT: "imported",
  AGENT: "by the agent",
};

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1));

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  if (!tenant) notFound();
  const money = (cents: number) => formatMoney(cents, tenant.currency, { decimals: true });

  const [{ items: expenses, pageCount }, split, duplicates, vehicles, trips, jobs] = await Promise.all([
    listExpenses(tenantId, undefined, page),
    spendSplit(tenantId),
    possibleDuplicates(tenantId),
    prisma.asset.findMany({
      where: { tenantId, status: { notIn: ["LOST", "RETIRED"] }, OR: [{ capacityUnit: { not: null } }, { category: { contains: "vehicle", mode: "insensitive" } }] },
      select: { id: true, name: true, registration: true },
      orderBy: { name: "asc" },
    }),
    prisma.trip.findMany({
      where: { tenantId, status: { in: ["UNDERWAY", "DONE"] } },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: { id: true, originText: true, destinationText: true, startedAt: true, asset: { select: { name: true } } },
    }),
    prisma.jobCard.findMany({
      where: { tenantId, status: { not: "DONE" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, party: { select: { name: true } } },
    }),
  ]);

  const canManage = access.role === "OWNER";
  const readSlip = readSlipAction.bind(null, tenantId);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Expenses" crumbs={[{ label: "Expenses" }]} />

      {/* What it actually costs to run this, versus what the owner took out.
          The unreviewed tile is deliberately as prominent as the other two —
          hiding it would reproduce the exact error this is here to fix. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">Business costs</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">{money(split.businessCents)}</p>
        </div>
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">Owner drawings</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">{money(split.drawingsCents)}</p>
        </div>
        <div className="kb-card px-4 py-3">
          <p className="text-[10px] tracking-wide uppercase text-[var(--kb-text-dim)]">Not split yet</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--kb-text)]">{money(split.unreviewedCents)}</p>
          <p className="text-[10px] text-[var(--kb-text-dim)]">{split.unreviewedCount} payment{split.unreviewedCount === 1 ? "" : "s"}</p>
        </div>
      </div>
      {split.summary && <p className="mt-2 text-xs text-[var(--kb-text-dim)]">{split.summary}</p>}

      <CaptureForm
        tenantId={tenantId}
        action={submitExpenseAction}
        readAction={readSlip}
        vehicles={vehicles.map((v) => ({ id: v.id, label: v.registration ? `${v.name} (${v.registration})` : v.name }))}
        trips={trips.map((t) => ({
          id: t.id,
          label: `${t.startedAt ? t.startedAt.toISOString().slice(0, 10) : "planned"} · ${t.asset?.name ?? "on foot"} · ${t.originText ?? "?"} → ${t.destinationText ?? "?"}`,
        }))}
        jobs={jobs.map((j) => ({ id: j.id, label: `${j.title} · ${j.party.name}` }))}
        currencySymbol={currencySymbol(tenant.currency)}
        today={new Date().toISOString().slice(0, 10)}
      />

      {duplicates.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-1 text-sm font-semibold text-[var(--kb-text)]">Arrived twice?</h3>
          <p className="mb-3 text-xs text-[var(--kb-text-dim)]">
            Same supplier, same amount, same day as something already recorded — the shape a slip takes when it is photographed and then lands on the statement. Counting both overstates costs.
          </p>
          <ul className="kb-card divide-y divide-[var(--kb-panel-border)]">
            {duplicates.map(({ expense: e, lookalike }) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--kb-text)]">
                    {e.descriptionText} · {money(e.amountCents)} · {e.spentOn.toISOString().slice(0, 10)}
                  </p>
                  {lookalike && (
                    <p className="text-xs text-[var(--kb-text-dim)]">
                      looks like {lookalike.descriptionText} · {money(lookalike.amountCents)} · {lookalike.spentOn.toISOString().slice(0, 10)} ({SOURCE_LABEL[lookalike.source]})
                    </p>
                  )}
                </div>
                {canManage && lookalike && (
                  <span className="flex gap-1">
                    <form action={markDuplicateAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="expenseId" value={e.id} />
                      <input type="hidden" name="ofExpenseId" value={lookalike.id} />
                      <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">Same one</button>
                    </form>
                    <form action={keepBothAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="expenseId" value={e.id} />
                      <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">Keep both</button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
        {expenses.length === 0 && (
          <li className="px-5 py-6 text-center text-sm text-[var(--kb-text-dim)]">Nothing recorded yet. The first slip goes in above.</li>
        )}
        {expenses.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="font-medium text-[var(--kb-text)]">
                {e.descriptionText} · {money(e.amountCents)}
              </p>
              <p className="text-xs text-[var(--kb-text-dim)]">
                {e.spentOn.toISOString().slice(0, 10)} · {e.submittedByName} · {SOURCE_LABEL[e.source] ?? e.source.toLowerCase()}
                {e.supplier?.name || e.supplierName ? ` · ${e.supplier?.name ?? e.supplierName}` : ""}
                {e.category ? ` · ${e.category}` : ""}
                {e.asset ? ` · ${e.asset.name}` : ""}
                {e.transaction ? ` · ${e.transaction.party.name}'s ${e.transaction.type.toLowerCase()}` : ""}
                {e.receiptDataUrl ? " · slip attached" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {e.isOwnerDrawing === null && e.status !== "DUPLICATE" ? (
                <span className="flex items-center gap-1">
                  <form action={classifyExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <input type="hidden" name="isOwnerDrawing" value="false" />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">Business</button>
                  </form>
                  <form action={classifyExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <input type="hidden" name="isOwnerDrawing" value="true" />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">Personal</button>
                  </form>
                </span>
              ) : (
                e.isOwnerDrawing && <span className="kb-pill text-[10px] uppercase text-[var(--kb-text-dim)]">Personal</span>
              )}
              <span className={`kb-tile ${STATUS_TINT[e.status]} !px-3 !py-1 text-[11px] font-semibold`}>{e.status}</span>
              {e.status === "PENDING" && canManage && (
                <>
                  <form action={approveExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Approve</button>
                  </form>
                  <form action={rejectExpenseAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="expenseId" value={e.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-xs">Reject</button>
                  </form>
                </>
              )}
              {e.status === "DUPLICATE" && canManage && (
                <form action={keepBothAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="expenseId" value={e.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost !py-1 text-[11px]">Not a duplicate</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} />
    </div>
  );
}
