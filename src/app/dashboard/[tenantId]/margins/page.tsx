import Link from "next/link";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { findCostRises, type RepricingLine } from "@/lib/core/repricing";
import { supplierPerformance, type SupplierStat } from "@/lib/core/supplierPerformance";
import { applyPriceAction } from "./actions";
import { moneyOf } from "@/lib/regions";

export const dynamic = "force-dynamic";


function Caveats({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    // Stated rather than implied. Numbers with no stated limits get
    // over-trusted, and the first time one is wrong the whole page stops
    // being believed.
    <details className="mt-3 text-xs text-[var(--kb-text-dim)]">
      <summary className="cursor-pointer select-none">What these numbers can&apos;t see</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {items.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </details>
  );
}

// The formatter comes in as a prop. A component that formats money without
// being told whose it is is a geo-lock waiting to happen.
function MarginTile({ line, tenantId, money }: { line: RepricingLine; tenantId: string; money: (cents: number) => string }) {
  const accent = line.sellingAtALoss ? "var(--kb-tint-peach-ink)" : "var(--kb-tint-yellow-ink)";

  return (
    <article
      className="kb-card flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-lg"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug text-[var(--kb-text)]">{line.name}</h3>
            {line.sku && <p className="text-xs text-[var(--kb-text-dim)]">{line.sku}</p>}
          </div>
          {line.sellingAtALoss && (
            <span
              className="kb-pill shrink-0 text-[10px] uppercase"
              style={{ background: "var(--kb-tint-peach)", color: "var(--kb-tint-peach-ink)" }}
            >
              At a loss
            </span>
          )}
        </div>

        {/* The whole story in two numbers: what every report says, and what is
            actually happening. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-[var(--kb-bg)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
              Reported margin
            </p>
            <p className="text-lg font-semibold tabular-nums text-[var(--kb-text-dim)] line-through">
              {line.marginAssumedPercent}%
            </p>
          </div>
          <div className="rounded-md bg-[var(--kb-bg)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
              Actual margin
            </p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: accent }}>
              {line.marginNowPercent}%
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[var(--kb-text-dim)]">{line.basis}</p>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--kb-panel-border)] px-5 py-2.5">
        <form action={applyPriceAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="itemId" value={line.itemId} />
          <input type="hidden" name="costCents" value={line.latestPaidCents} />
          <label className="text-[11px] text-[var(--kb-text-dim)]">
            New price
            <input
              type="number"
              name="price"
              step="any"
              min={0.01}
              defaultValue={(line.suggestedPriceCents / 100).toFixed(2)}
              className="kb-input ml-1.5 w-24 px-1.5 py-1 text-[11px]"
              aria-label={`New price for ${line.name}`}
            />
          </label>
          <SubmitButton pendingText="Saving…">Reprice</SubmitButton>
        </form>
        <span className="text-[11px] text-[var(--kb-text-dim)]">
          was {money(line.unitPriceCents)}
        </span>
      </div>
    </article>
  );
}

function SupplierTile({ stat, money }: { stat: SupplierStat; money: (cents: number) => string }) {
  const flagged = stat.flags.length > 0;
  const accent = flagged ? "var(--kb-tint-yellow-ink)" : "var(--kb-tint-blue-ink)";

  return (
    <article
      className="kb-card flex flex-col gap-3 p-5 transition-shadow hover:shadow-lg"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug text-[var(--kb-text)]">{stat.name}</h3>
        <div className="shrink-0 text-right">
          <div className="text-xl leading-none font-semibold tabular-nums text-[var(--kb-text)]">
            {stat.medianLeadDays ?? "—"}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--kb-text-dim)]">days, usually</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-[var(--kb-bg)] px-2 py-1.5">
          <p className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">
            {stat.ordersPlaced}
          </p>
          <p className="text-[10px] text-[var(--kb-text-dim)]">orders</p>
        </div>
        <div className="rounded-md bg-[var(--kb-bg)] px-2 py-1.5">
          <p className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">
            {stat.worstLeadDays ?? "—"}
          </p>
          <p className="text-[10px] text-[var(--kb-text-dim)]">worst</p>
        </div>
        <div className="rounded-md bg-[var(--kb-bg)] px-2 py-1.5">
          <p className="text-sm font-semibold tabular-nums text-[var(--kb-text)]">
            {stat.priceDriftPercent === null
              ? "—"
              : `${stat.priceDriftPercent > 0 ? "+" : ""}${stat.priceDriftPercent}%`}
          </p>
          <p className="text-[10px] text-[var(--kb-text-dim)]">price drift</p>
        </div>
      </div>

      <p className="text-xs text-[var(--kb-text-dim)]">{money(stat.totalSpentCents)} spent</p>

      {flagged && (
        <ul className="space-y-1">
          {stat.flags.map((f) => (
            <li key={f} className="text-xs leading-relaxed text-[var(--kb-text-dim)]">
              {f}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default async function MarginsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  // This workspace's own money, never the one the code was written in.
  const money = await moneyOf(tenantId);
  const [repricing, suppliers] = await Promise.all([
    findCostRises(tenantId),
    supplierPerformance(tenantId),
  ]);

  const nothingYet = repricing.lines.length === 0 && suppliers.suppliers.length === 0;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Margins &amp; suppliers</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Where money leaks quietly. Both halves of a cost rise look correct on their own — the price
        you set was right when you set it, and the invoice you paid is right too. Only the
        comparison is news.
      </p>

      {nothingYet && (
        <div className="kb-card mt-6 px-5 py-5">
          <p className="text-sm text-[var(--kb-text)]">
            Nothing to compare yet. This reads purchase orders you have marked as received against
            the costs on your catalogue, so it fills in as you record what you actually pay.
          </p>
          <Link
            href={`/dashboard/${tenantId}/purchase-orders`}
            className="mt-3 inline-block text-sm text-[var(--kb-accent)] hover:underline"
          >
            Purchase orders →
          </Link>
        </div>
      )}

      {repricing.lines.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">Costing more than you think</h2>
            <span className="text-xs text-[var(--kb-text-dim)]">{repricing.lines.length}</span>
          </div>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">{repricing.summary}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {repricing.lines.map((l) => (
              <MarginTile money={money} key={l.itemId} line={l} tenantId={tenantId} />
            ))}
          </div>
          <Caveats items={repricing.caveats} />
        </section>
      )}

      {suppliers.suppliers.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-[var(--kb-text)]">Suppliers</h2>
            <span className="text-xs text-[var(--kb-text-dim)]">{suppliers.suppliers.length}</span>
          </div>
          <p className="mt-0.5 max-w-prose text-sm text-[var(--kb-text-dim)]">{suppliers.summary}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {suppliers.suppliers.map((s) => (
              <SupplierTile money={money} key={s.supplierId} stat={s} />
            ))}
          </div>
          <Caveats items={suppliers.caveats} />
        </section>
      )}
    </main>
  );
}
