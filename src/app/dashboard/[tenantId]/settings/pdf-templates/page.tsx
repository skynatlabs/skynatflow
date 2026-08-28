import { listPdfTemplates } from "@/lib/core/pdfTemplates";
import { PDF_STYLE_LIST } from "@/lib/pdf/styles";
import { createPdfTemplateAction, setDefaultPdfTemplateAction, deletePdfTemplateAction } from "./actions";

export default async function PdfTemplatesPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const templates = await listPdfTemplates(tenantId);
  const invoiceStyles = PDF_STYLE_LIST.filter((s) => !s.isSlip);
  const slipStyles = PDF_STYLE_LIST.filter((s) => s.isSlip);
  const canAddMore = templates.length < 3;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">PDF templates</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        10 invoice/quote layouts plus 2 delivery-slip layouts to choose from. Save up to 3 — one
        default, two customized — each with your own accent color and logo.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Your saved templates</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{t.name}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{t.styleKey}</p>
              </div>
              <div className="flex items-center gap-2">
                {t.isDefault ? (
                  <span className="kb-pill kb-pill-primary text-xs">Default</span>
                ) : (
                  <form action={setDefaultPdfTemplateAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="templateId" value={t.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost text-xs">Make default</button>
                  </form>
                )}
                <form action={deletePdfTemplateAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <button type="submit" className="text-xs text-red-500 hover:underline">Remove</button>
                </form>
              </div>
            </li>
          ))}
          {templates.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">
              Nothing saved yet — a plain default is used until you add one.
            </li>
          )}
        </ul>
      </section>

      {canAddMore ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">Add a template</h2>
          <form action={createPdfTemplateAction} className="kb-card mt-3 flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Name</span>
              <input name="name" required placeholder="e.g. Standard invoice" className="mt-1 w-48 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Style</span>
              <select name="styleKey" required className="mt-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm">
                <optgroup label="Invoice / Quote">
                  {invoiceStyles.map((s) => (
                    <option key={s.key} value={s.key}>{s.label} ({s.family})</option>
                  ))}
                </optgroup>
                <optgroup label="Delivery slip">
                  {slipStyles.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="text-xs">
              <span className="block font-medium text-[var(--kb-text-dim)]">Accent color (optional)</span>
              <input name="accentColorHex" type="color" className="mt-1 h-9 w-16 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)]" />
            </label>
            <button type="submit" className="kb-pill kb-pill-primary text-xs">Save template</button>
          </form>
        </section>
      ) : (
        <p className="mt-6 text-xs text-[var(--kb-text-dim)]">
          You&apos;ve saved the maximum of 3 templates — remove one to add another.
        </p>
      )}
    </main>
  );
}
