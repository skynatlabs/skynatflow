import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEFAULT_SECTION_ORDER } from "@/lib/pdf/DocumentTemplate";
import { SectionBuilder } from "./SectionBuilder";

export default async function PdfTemplateEditorPage({
  params,
}: {
  params: Promise<{ tenantId: string; templateId: string }>;
}) {
  const { tenantId, templateId } = await params;
  const template = await prisma.tenantPdfTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.tenantId !== tenantId) notFound();

  const savedOrder = (template.sectionOrder as string[] | null) ?? DEFAULT_SECTION_ORDER;
  const hiddenSections = (template.hiddenSections as string[] | null) ?? [];
  // Any section not yet in the saved order (e.g. added after this
  // template was first created) is appended, visible by default — never
  // silently dropped from the layout.
  const initialOrder = [...savedOrder, ...DEFAULT_SECTION_ORDER.filter((k) => !savedOrder.includes(k))];

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
