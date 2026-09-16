// The VAT return.
//
// Not a filing integration — nothing here talks to a revenue service. It is
// the return worked out from the ledger, box by box, with what went into each
// one and what it is not counting, so the figure handed over is one somebody
// can defend.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { computeVatReturn, driftSinceFiling, listVatReturns, vatPeriodFor } from "@/lib/core/vatReturn";
import { formatMoney } from "@/lib/format/money";
import { PageHeader } from "../../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { fileReturnAction, saveReturnAction } from "./actions";

export const dynamic = "force-dynamic";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function VatPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { tenantId } = await params;
  const { from, to } = await searchParams;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const period = from && to ? { start: new Date(from), end: new Date(to) } : vatPeriodFor(new Date());
  const [computed, filedReturns] = await Promise.all([
    computeVatReturn(tenantId, period.start, period.end),
    listVatReturns(tenantId),
  ]);
  const money = (c: number) => formatMoney(c, computed.currency, { decimals: true });

  const alreadyFiled = filedReturns.find(
    (r) => r.status === "FILED" && iso(r.periodStart) === iso(period.start) && iso(r.periodEnd) === iso(period.end)
  );
  const drift = alreadyFiled ? await driftSinceFiling(tenantId, alreadyFiled.id) : null;

  // The three periods either side, so moving between them is a click.
  const neighbours = [-2, -1, 0, 1].map((offset) => {
    const anchor = new Date(period.start);
    anchor.setUTCMonth(anchor.getUTCMonth() + offset * 2);
    return vatPeriodFor(anchor);
  });

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="VAT return"
        crumbs={[{ label: "The books", href: `/dashboard/${tenantId}/books` }, { label: "VAT return" }]}
      />

      <p className="-mt-2 mb-4 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Worked out from the ledger, not typed. Nothing here is submitted anywhere — it is the figure to hand over, with
        what went into each box so it can be argued with.
      </p>

      <div className="mb-5 flex flex-wrap gap-1">
        {neighbours.map((p) => {
          const active = iso(p.start) === iso(period.start);
          return (
            <Link
              key={p.label}
              href={`/dashboard/${tenantId}/books/vat?from=${iso(p.start)}&to=${iso(p.end)}`}
              className={`kb-pill text-xs ${active ? "kb-pill-primary" : "kb-pill-ghost"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {alreadyFiled && (
        <div className="kb-card mb-4 px-5 py-4" style={{ background: "var(--kb-tint-mint)" }}>
          <p className="text-sm font-medium text-[var(--kb-text)]">
            Filed {alreadyFiled.filedAt?.toLocaleDateString()}
            {alreadyFiled.reference ? ` · reference ${alreadyFiled.reference}` : ""} · {money(alreadyFiled.netCents)}
          </p>
          {drift?.changed && <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{drift.note}</p>}
        </div>
      )}

      <section className="kb-card overflow-hidden p-0">
        <table className="w-full text-sm">
          <tbody>
            {computed.boxes.map((box) => (
              <tr key={box.code} className="border-b border-[var(--kb-panel-border)] last:border-0">
                <td className="px-5 py-3 align-top">
                  <p className="font-medium text-[var(--kb-text)]">
                    <span className="mr-2 text-xs text-[var(--kb-text-dim)]">{box.code}</span>
                    {box.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{box.basis}</p>
                </td>
                <td className="px-5 py-3 text-right align-top text-base font-semibold tabular-nums text-[var(--kb-text)]">
                  {money(box.cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="kb-card mt-4 px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
          {computed.netCents >= 0 ? "Payable" : "Refundable"}
        </p>
        <p
          className="mt-1 text-3xl font-semibold"
          style={{ color: computed.netCents > 0 ? "var(--kb-status-danger-ink)" : "var(--kb-tint-mint-ink)" }}
        >
          {money(Math.abs(computed.netCents))}
        </p>
      </div>

      <ul className="mt-4 space-y-1">
        {computed.caveats.map((c) => (
          <li key={c} className="text-xs text-[var(--kb-text-dim)]">
            · {c}
          </li>
        ))}
      </ul>

      {!alreadyFiled && (
        <div className="mt-5 flex flex-wrap gap-3">
          <form action={saveReturnAction.bind(null, tenantId)}>
            <input type="hidden" name="periodStart" value={period.start.toISOString()} />
            <input type="hidden" name="periodEnd" value={period.end.toISOString()} />
            <SubmitButton pendingText="Saving…">Save the working</SubmitButton>
          </form>
          <form action={fileReturnAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="periodStart" value={period.start.toISOString()} />
            <input type="hidden" name="periodEnd" value={period.end.toISOString()} />
            <input name="reference" placeholder="Their reference, once you have it" className="kb-input text-sm" />
            <button type="submit" className="kb-pill kb-pill-ghost text-xs">
              Mark it filed
            </button>
          </form>
        </div>
      )}

      <p className="mt-3 max-w-prose text-xs text-[var(--kb-text-dim)]">
        Marking it filed freezes these numbers for good. A return that quietly restates when a backdated invoice arrives
        is worse than no return, because it disagrees with the one the revenue service already has — anything that lands
        afterwards is shown here and carried into the next period instead.
      </p>
    </div>
  );
}
