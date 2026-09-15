import { prisma } from "@/lib/db";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { assetSummary, listAssets } from "@/lib/core/assets";
import {
  addAssetAction,
  issueAssetAction,
  retireAssetAction,
  returnAssetAction,
} from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return (cents / 100).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
}

const STATUS_TONE: Record<string, { bg: string; ink: string }> = {
  ISSUED: { bg: "var(--kb-tint-blue)", ink: "var(--kb-tint-blue-ink)" },
  IN_STOCK: { bg: "var(--kb-tint-mint)", ink: "var(--kb-tint-mint-ink)" },
  IN_REPAIR: { bg: "var(--kb-tint-yellow)", ink: "var(--kb-tint-yellow-ink)" },
  LOST: { bg: "var(--kb-tint-peach)", ink: "var(--kb-tint-peach-ink)" },
  RETIRED: { bg: "var(--kb-panel-border)", ink: "var(--kb-text-dim)" },
};

const STATUS_LABEL: Record<string, string> = {
  ISSUED: "Out",
  IN_STOCK: "In stock",
  IN_REPAIR: "In repair",
  LOST: "Lost",
  RETIRED: "Retired",
};

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [assets, summary, members] = await Promise.all([
    listAssets(tenantId),
    assetSummary(tenantId),
    prisma.membership.findMany({
      where: { tenantId },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  const live = assets.filter((a) => a.status !== "RETIRED");
  const retired = assets.filter((a) => a.status === "RETIRED");

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Assets</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Who has which laptop, drill, phone or vehicle. Issues and returns are kept as a history,
        so &ldquo;who had it in March&rdquo; stays answerable in June.
      </p>

      {summary.summary && (
        <div
          className="mt-5 rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" }}
        >
          {summary.summary}
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Out with people", value: String(summary.issued) },
          { label: "In stock", value: String(summary.inStock) },
          { label: "In repair", value: String(summary.inRepair) },
          {
            label: "Value at cost",
            value: money(summary.valueAtCostCents),
            note:
              summary.missingValue > 0
                ? `${summary.missingValue} without a recorded price`
                : undefined,
          },
        ].map((tile) => (
          <div key={tile.label} className="kb-card px-5 py-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--kb-text-dim)]">
              {tile.label}
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--kb-text)]">
              {tile.value}
            </p>
            {tile.note && <p className="text-[11px] text-[var(--kb-text-dim)]">{tile.note}</p>}
          </div>
        ))}
      </div>

      {live.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">The register</h2>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {live.map((a) => {
              const tone = STATUS_TONE[a.status] ?? STATUS_TONE.IN_STOCK;
              const holder = a.holder?.user?.name ?? a.holder?.user?.email ?? null;
              return (
                <li key={a.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--kb-text)]">{a.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                        {[a.category, a.serial, holder ? `with ${holder}` : null]
                          .filter(Boolean)
                          .join(" · ") || "No details recorded"}
                      </p>
                    </div>
                    <span
                      className="kb-pill shrink-0 text-[10px] uppercase"
                      style={{ background: tone.bg, color: tone.ink }}
                    >
                      {STATUS_LABEL[a.status]}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {a.status === "ISSUED" ? (
                      <>
                        <form action={returnAssetAction}>
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="assetId" value={a.id} />
                          <SubmitButton pendingText="…">Returned</SubmitButton>
                        </form>
                        <form action={returnAssetAction}>
                          <input type="hidden" name="tenantId" value={tenantId} />
                          <input type="hidden" name="assetId" value={a.id} />
                          <input type="hidden" name="toRepair" value="on" />
                          <SubmitButton className="kb-pill kb-pill-ghost text-xs" pendingText="…">
                            Back, broken
                          </SubmitButton>
                        </form>
                      </>
                    ) : (
                      <form action={issueAssetAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="assetId" value={a.id} />
                        <select
                          name="membershipId"
                          required
                          className="kb-input px-1.5 py-1 text-[11px]"
                          aria-label={`Issue ${a.name} to`}
                        >
                          <option value="">Give to…</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.user?.name ?? m.user?.email}
                            </option>
                          ))}
                        </select>
                        <SubmitButton pendingText="…">Issue</SubmitButton>
                      </form>
                    )}

                    <form action={retireAssetAction} className="ml-auto">
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="assetId" value={a.id} />
                      <input type="hidden" name="lost" value="true" />
                      <SubmitButton
                        className="kb-pill kb-pill-ghost text-[11px] text-[var(--kb-text-dim)]"
                        pendingText="…"
                      >
                        Lost
                      </SubmitButton>
                    </form>
                    <form action={retireAssetAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="assetId" value={a.id} />
                      <SubmitButton
                        className="kb-pill kb-pill-ghost text-[11px] text-[var(--kb-text-dim)]"
                        pendingText="…"
                      >
                        Retire
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {retired.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-[var(--kb-text-dim)]">
            {retired.length} retired or lost
          </summary>
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {retired.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm text-[var(--kb-text-dim)]">
                {a.name}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Add something</h2>
        <form action={addAssetAction} className="kb-card mt-3 space-y-3 px-5 py-5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">What is it</span>
              <input
                name="name"
                required
                placeholder="Hilti TE 30 drill"
                className="kb-input mt-1 w-full text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Kind</span>
              <input
                name="category"
                placeholder="power tool, laptop, vehicle…"
                className="kb-input mt-1 w-full text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-[var(--kb-text-dim)]">Serial or registration</span>
              <input name="serial" className="kb-input mt-1 w-full text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">What it cost</span>
                <input
                  type="number"
                  name="purchasePrice"
                  step="any"
                  min={0}
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--kb-text-dim)]">
                  Life, months
                </span>
                <input
                  type="number"
                  name="usefulLifeMonths"
                  min={1}
                  placeholder="60"
                  className="kb-input mt-1 w-full text-sm"
                />
              </label>
            </div>
          </div>
          <p className="text-[11px] text-[var(--kb-text-dim)]">
            Cost and life are optional, and only used for depreciation later — leave them blank if
            you don&apos;t know.
          </p>
          <SubmitButton pendingText="Adding…">Add to the register</SubmitButton>
        </form>
      </section>
    </main>
  );
}
