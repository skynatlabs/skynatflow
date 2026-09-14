import { listPdfTemplates } from "@/lib/core/pdfTemplates";
import { getPdfStyle } from "@/lib/pdf/styles";
import { DOCUMENT_PRESETS } from "@/lib/pdf/presets";
import { TemplateCard } from "./TemplateCard";
import {
  createPdfTemplateAction,
  setDefaultPdfTemplateAction,
  deletePdfTemplateAction,
} from "./actions";

export const dynamic = "force-dynamic";

const MAX_TEMPLATES = 12;

export default async function PdfTemplatesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const templates = await listPdfTemplates(tenantId);
  const canAddMore = templates.length < MAX_TEMPLATES;

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">
            Document templates
          </h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Start from a design, then edit it block by block. Point different templates at quotes,
            invoices and delivery slips.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------ gallery */}
      {templates.length > 0 && (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              tenantId={tenantId}
              templateId={t.id}
              name={t.name}
              styleLabel={getPdfStyle(t.styleKey).label}
              appliesTo={t.appliesTo ?? "ALL"}
              isDefault={t.isDefault}
              makeDefault={
                t.isDefault ? null : (
                  <form action={setDefaultPdfTemplateAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="templateId" value={t.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost text-[11px]">
                      Make default
                    </button>
                  </form>
                )
              }
              remove={
                <form action={deletePdfTemplateAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <button type="submit" className="text-[11px] text-white/70 hover:text-white">
                    Remove
                  </button>
                </form>
              }
            />
          ))}
        </div>
      )}

      {templates.length === 0 && (
        <p className="kb-card mt-6 p-5 text-sm text-[var(--kb-text-dim)]">
          No templates yet — a plain default is used for your documents until you add one below.
        </p>
      )}

      {/* ---------------------------------------------------------- new one */}
      {canAddMore ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">New template</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Pick the design it starts as. Everything stays editable afterwards.
          </p>

          <form action={createPdfTemplateAction} className="kb-card mt-3 p-4 sm:p-5">
            <input type="hidden" name="tenantId" value={tenantId} />

            <label className="block max-w-sm text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
              <input
                name="name"
                required
                placeholder="e.g. Standard invoice"
                className="mt-1 w-full rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] px-2.5 py-1.5 text-sm text-[var(--kb-text)]"
              />
            </label>

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-[var(--kb-text-dim)]">Design</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {DOCUMENT_PRESETS.map((preset, i) => (
                  <label
                    key={preset.key}
                    className="cursor-pointer rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-3 transition has-[:checked]:border-[var(--kb-accent-a)]"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="presetKey"
                        value={preset.key}
                        defaultChecked={i === 0}
                        required
                      />
                      <span className="text-sm font-medium text-[var(--kb-text)]">
                        {preset.label}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-[var(--kb-text-dim)]">
                      {preset.description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button type="submit" className="kb-pill kb-pill-primary mt-4 text-xs">
              Create template
            </button>
          </form>
        </section>
      ) : (
        <p className="mt-6 text-xs text-[var(--kb-text-dim)]">
          You&apos;ve saved the maximum of {MAX_TEMPLATES} templates — remove one to add another.
        </p>
      )}
    </main>
  );
}
