// What else you run — and how much of the business is actually here yet.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { CATEGORY_LABEL, SYSTEM_CATALOGUE, listSystems, switchover } from "@/lib/core/systems";
import { PageHeader } from "../PageHeader";
import { AddSystem } from "./AddSystem";
import { SystemImport } from "./SystemImport";
import { addSystemAction, recordImportAction, removeSystemAction, retireSystemAction, setSystemOfRecordAction } from "./actions";

export const dynamic = "force-dynamic";

const LINK_LABEL: Record<string, string> = {
  live: "Connected live",
  import: "Bring the file over",
  api: "Their side can push to our API",
};

export default async function SystemsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [mine, move] = await Promise.all([listSystems(tenantId), switchover(tenantId)]);
  const onList = new Set(mine.map((s) => s.systemKey));

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="What else you run" crumbs={[{ label: "What else you run" }]} />

      <p className="-mt-2 mb-5 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Nobody rips out the till on a Tuesday because a new system asked them to. Tell us what you already use and we
        will sit underneath it: take your history out of it, keep taking the daily numbers, and leave you using it for
        as long as you like. What is below is measured from your own data — not a sales pitch.
      </p>

      {/* The case for moving the rest, made out of what is actually missing. */}
      <section className="kb-card mb-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">How much runs here</p>
            <p className="mt-1 text-3xl font-semibold text-[var(--kb-text)]">{move.percent}%</p>
          </div>
          {move.stillElsewhere.length > 0 && (
            <p className="text-xs text-[var(--kb-text-dim)]">
              Your records still live in {move.stillElsewhere.map((s) => s.label).join(", ")}.
            </p>
          )}
        </div>

        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--kb-panel-border)" }}
          role="img"
          aria-label={`${move.percent} percent of the business runs here`}
        >
          <div className="h-full rounded-full" style={{ width: `${move.percent}%`, background: "var(--kb-accent-a)" }} />
        </div>

        {move.gaps.length > 0 && (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">
              What this workspace cannot do yet, and why
            </p>
            <ul className="mt-2 space-y-2">
              {move.gaps.map((g) => (
                <li key={g.key} className="rounded-xl p-3" style={{ background: "var(--kb-tint-yellow)" }}>
                  <p className="text-sm text-[var(--kb-text)]">{g.missing}</p>
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                    {g.needs}
                    {g.heldBy ? ` It is in ${g.heldBy} at the moment.` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        {move.onFlow.length > 0 && (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-[var(--kb-text-dim)]">Already here</p>
            <ul className="mt-1 space-y-0.5">
              {move.onFlow.map((line) => (
                <li key={line} className="text-sm text-[var(--kb-text-dim)]">
                  · {line}
                </li>
              ))}
            </ul>
          </>
        )}

        {move.movedOff.length > 0 && (
          <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
            Moved off: {move.movedOff.map((m) => `${m.label} (${m.on.toLocaleDateString()})`).join(", ")}.
          </p>
        )}
      </section>

      <AddSystem
        options={SYSTEM_CATALOGUE.map((s) => ({
          key: s.key,
          label: s.label,
          category: s.category,
          what: s.what,
          already: onList.has(s.key),
        }))}
        categoryLabel={CATEGORY_LABEL}
        addAction={addSystemAction.bind(null, tenantId)}
      />

      <section className="mt-5 space-y-3">
        {mine.length === 0 ? (
          <p className="kb-card p-5 text-sm text-[var(--kb-text-dim)]">
            Nothing listed yet. Add your till, your accounting package, your shop, or the spreadsheet everything really
            lives in — the answer is usually all four, and nobody here minds.
          </p>
        ) : (
          mine.map((s) => (
            <article key={s.id} className="kb-card p-5" style={s.retiredAt ? { opacity: 0.6 } : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--kb-text)]">
                    {s.label ?? s.def.label}
                    <span className="ml-2 text-xs font-normal text-[var(--kb-text-dim)]">
                      {CATEGORY_LABEL[s.def.category]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{s.def.what}</p>
                  {s.notes && <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{s.notes}</p>}
                  <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                    {s.def.links.map((l) => LINK_LABEL[l]).join(" · ")}
                    {s.lastImportAt
                      ? ` · ${s.importedRecords} records brought over, last on ${s.lastImportAt.toLocaleDateString()}`
                      : " · nothing brought over yet"}
                  </p>
                </div>

                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {s.retiredAt ? (
                    <span className="kb-pill text-[10px]" style={{ background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }}>
                      moved off {s.retiredAt.toLocaleDateString()}
                    </span>
                  ) : (
                    <>
                      <form action={setSystemOfRecordAction.bind(null, tenantId, s.systemKey, !s.isSystemOfRecord)}>
                        <button
                          type="submit"
                          className="kb-pill text-[10px]"
                          style={
                            s.isSystemOfRecord
                              ? { background: "var(--kb-tint-yellow)", color: "var(--kb-tint-yellow-ink)" }
                              : { background: "var(--kb-tint-mint)", color: "var(--kb-tint-mint-ink)" }
                          }
                        >
                          {s.isSystemOfRecord ? "Records still live there" : "Records live here now"}
                        </button>
                      </form>
                      <form action={retireSystemAction.bind(null, tenantId, s.systemKey)}>
                        <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                          We have moved off it
                        </button>
                      </form>
                    </>
                  )}
                  <form action={removeSystemAction.bind(null, tenantId, s.systemKey)}>
                    <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                      Remove
                    </button>
                  </form>
                </span>
              </div>

              {!s.retiredAt && (
                <div className="mt-3">
                  <SystemImport
                    tenantId={tenantId}
                    systemKey={s.systemKey}
                    systemLabel={s.label ?? s.def.label}
                    exportPath={s.def.exportPath}
                    brings={s.def.brings}
                    recordImport={recordImportAction.bind(null, tenantId, s.systemKey)}
                  />
                </div>
              )}
            </article>
          ))
        )}
      </section>

      <p className="mt-6 max-w-prose text-xs text-[var(--kb-text-dim)]">
        Building something yourself? There is a keyed REST API and signed webhooks under{" "}
        <Link href={`/dashboard/${tenantId}/settings/developer`} className="underline">
          Settings → API
        </Link>
        , so a till or a shop that nothing here connects to can still push its sales in.
      </p>
    </div>
  );
}
