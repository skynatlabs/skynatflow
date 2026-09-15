import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ACCENT_PALETTES, DEFAULT_ACCENT, getAccentForUser } from "@/lib/ai/model";
import { setAccentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppearancePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const current = await getAccentForUser(access.userId);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Appearance</h1>
      <p className="mt-1 max-w-prose text-sm text-[var(--kb-text-dim)]">
        Your accent colour — the buttons, links and key figures. This is yours alone: it follows
        you between workspaces and nobody else sees your choice.
      </p>
      <p className="mt-2 max-w-prose text-xs text-[var(--kb-text-dim)]">
        Only the accent moves. Backgrounds, text and borders stay as they are in both light and
        dark, so no palette can leave anything hard to read.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(ACCENT_PALETTES) as Array<keyof typeof ACCENT_PALETTES>).map((key) => {
          const p = ACCENT_PALETTES[key];
          const isCurrent = current === key;
          return (
            <article
              key={key}
              className="kb-card flex flex-col gap-3 p-5 transition-shadow hover:shadow-lg"
              style={{ borderTop: `3px solid ${p.a}` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-[var(--kb-text)]">
                    {p.label}
                    {key === DEFAULT_ACCENT && (
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-[var(--kb-text-dim)]">
                        default
                      </span>
                    )}
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--kb-text-dim)]">
                    {p.note}
                  </p>
                </div>
                <span className="flex shrink-0 gap-1" aria-hidden="true">
                  {[p.a, p.mid, p.b].map((c) => (
                    <span
                      key={c}
                      className="h-6 w-6 rounded-full border border-black/10"
                      style={{ background: c }}
                    />
                  ))}
                </span>
              </div>

              {/* A real button in the palette's own colour, because a row of
                  swatches does not show what a button will actually look like. */}
              <div className="flex items-center gap-2">
                <span
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: p.a }}
                >
                  Send quote
                </span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: p.a }}>
                  R12 400
                </span>
              </div>

              {isCurrent ? (
                <span className="kb-pill kb-pill-primary mt-auto self-start text-xs">In use</span>
              ) : (
                <form action={setAccentAction} className="mt-auto">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="accent" value={key} />
                  <SubmitButton
                    className="kb-pill kb-pill-ghost text-xs"
                    pendingText="Applying…"
                  >
                    Use this
                  </SubmitButton>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
