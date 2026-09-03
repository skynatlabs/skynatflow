import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEFAULT_SECTION_ORDER } from "@/lib/pdf/DocumentTemplate";
import { getPdfStyle } from "@/lib/pdf/styles";
import { SectionBuilder } from "./SectionBuilder";
import { saveStyleOverridesAction } from "./actions";

export default async function PdfTemplateEditorPage({
  params,
}: {
  params: Promise<{ tenantId: string; templateId: string }>;
}) {
  const { tenantId, templateId } = await params;
  const template = await prisma.tenantPdfTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.tenantId !== tenantId) notFound();

  const savedOrder = Array.isArray(template.sectionOrder)
    ? (template.sectionOrder as string[])
    : DEFAULT_SECTION_ORDER;
  const hiddenSections = Array.isArray(template.hiddenSections) ? (template.hiddenSections as string[]) : [];
  // Any section not yet in the saved order (e.g. added after this
  // template was first created) is appended, visible by default — never
  // silently dropped from the layout.
  const initialOrder = [...savedOrder, ...DEFAULT_SECTION_ORDER.filter((k) => !savedOrder.includes(k))];
  const baseStyle = getPdfStyle(template.styleKey);

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href={`/dashboard/${tenantId}/settings/pdf-templates`}
        className="text-xs text-[var(--kb-text-dim)] hover:underline"
      >
        &larr; Back to templates
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--kb-text)]">{template.name} — layout</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Customize which optional sections appear on this template, and in what order.
      </p>

      <div className="kb-card mt-6 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Appearance
        </h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Fine-tune this template beyond the base style — leave anything on "Default" to keep what
          the style already does.
        </p>
        <form action={saveStyleOverridesAction} className="mt-3 grid grid-cols-2 gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="templateId" value={templateId} />
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Font</span>
            <select
              name="fontFamily"
              defaultValue={template.fontFamily ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            >
              <option value="">Default ({baseStyle.fontFamily})</option>
              <option value="Helvetica">Helvetica (sans-serif)</option>
              <option value="Times-Roman">Times Roman (serif)</option>
              <option value="Courier">Courier (monospace)</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Header layout</span>
            <select
              name="headerLayout"
              defaultValue={template.headerLayout ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            >
              <option value="">Default ({baseStyle.headerLayout})</option>
              <option value="centered">Centered</option>
              <option value="split">Split (logo left, details right)</option>
              <option value="band">Colored band</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Item table header</span>
            <select
              name="tableHeaderStyle"
              defaultValue={template.tableHeaderStyle ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            >
              <option value="">Default ({baseStyle.tableHeaderStyle})</option>
              <option value="dark">Dark fill</option>
              <option value="accent">Accent color fill</option>
              <option value="line-only">Line only (no fill)</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-medium text-[var(--kb-text-dim)]">Logo shape</span>
            <select
              name="logoShape"
              defaultValue={template.logoShape ?? ""}
              className="mt-1 w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm"
            >
              <option value="">Default ({baseStyle.logoShape})</option>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="none">No logo</option>
            </select>
          </label>
          <button type="submit" className="kb-pill kb-pill-primary col-span-2 text-xs">
            Save appearance
          </button>
        </form>
      </div>

      <div className="kb-card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">
          Sections
        </h2>
        <SectionBuilder
          tenantId={tenantId}
          templateId={templateId}
          initialOrder={initialOrder}
          initialHidden={hiddenSections}
        />
      </div>
    </main>
  );
}
