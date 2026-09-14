import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getPdfStyle, PAGE_MARGINS, PT_PER_INCH } from "@/lib/pdf/styles";
import { createHash } from "node:crypto";
import { resolveSections } from "@/lib/pdf/sections";
import { TemplateStudio } from "./TemplateStudio";

export const dynamic = "force-dynamic";

export default async function PdfTemplateEditorPage({
  params,
}: {
  params: Promise<{ tenantId: string; templateId: string }>;
}) {
  const { tenantId, templateId } = await params;

  const [template, tenant] = await Promise.all([
    prisma.tenantPdfTemplate.findUnique({ where: { id: templateId } }),
    prisma.tenant.findUnique({ where: { id: tenantId } }),
  ]);
  if (!template || template.tenantId !== tenantId || !tenant) notFound();

  const base = getPdfStyle(template.styleKey);
  // The margin boxes always show a number. Falling back to the preset the
  // template is actually rendering with means what you read is what you get,
  // rather than four empty boxes beside a document that plainly has margins.
  const presetInches =
    (PAGE_MARGINS[template.pageMargin ?? "normal"] ?? PAGE_MARGINS.normal) / PT_PER_INCH;
  const round = (n: number) => Math.round(n * 100) / 100;

  // A fingerprint of what the renderer will read. The preview URL carries it,
  // so a save busts the iframe's cache and a no-op save doesn't — which is
  // what makes "Save" visibly do something without the client having to
  // guess whether the write landed.
  const version = createHash("sha1")
    .update(JSON.stringify({ ...template, logoDataUrl: template.logoDataUrl?.length ?? 0 }))
    .digest("hex")
    .slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-[95rem] p-4 sm:p-6 lg:p-8">
      <Link
        href={`/dashboard/${tenantId}/settings/pdf-templates`}
        className="text-xs text-[var(--kb-text-dim)] hover:underline"
      >
        &larr; Back to templates
      </Link>

      <div className="mt-3">
        <TemplateStudio
          tenantId={tenantId}
          templateId={templateId}
          baseStyle={base}
          logoDataUrl={template.logoDataUrl}
          previewSrc={`/api/dashboard/${tenantId}/pdf-templates/${templateId}/preview`}
          version={version}
          initialSections={resolveSections(template.sections)}
          initialSettings={{
            name: template.name,
            styleKey: template.styleKey,
            appliesTo: template.appliesTo ?? "ALL",
            accentColorHex: template.accentColorHex ?? base.accentColor,
            textColorHex: template.textColorHex ?? base.textColor,
            mutedColorHex: template.mutedColorHex ?? base.mutedColor,
            backgroundHex: template.backgroundHex ?? "#ffffff",
            fontFamily: template.fontFamily ?? "",
            fontScale: template.fontScale ?? 1,
            headerLayout: template.headerLayout ?? "",
            tableHeaderStyle: template.tableHeaderStyle ?? "",
            logoShape: template.logoShape ?? "",
            pageSize: template.pageSize ?? "A4",
            orientation: template.orientation ?? "portrait",
            pageMargin: template.pageMargin ?? "",
            marginTopIn: round(template.marginTopIn ?? presetInches),
            marginBottomIn: round(template.marginBottomIn ?? presetInches),
            marginLeftIn: round(template.marginLeftIn ?? presetInches),
            marginRightIn: round(template.marginRightIn ?? presetInches),
          }}
          initialBusiness={{
            businessAddress: tenant.businessAddress ?? "",
            businessEmail: tenant.businessEmail ?? "",
            businessPhone: tenant.businessPhone ?? "",
            vatNumber: tenant.vatNumber ?? "",
            registrationNumber: tenant.registrationNumber ?? "",
          }}
        />
      </div>
    </main>
  );
}
