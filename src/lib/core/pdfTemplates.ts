// Tenant-owned PDF templates — pick a base style (PDF_STYLES), optionally
// override its accent color/logo, and mark one as the default used for
// every quote/invoice/slip PDF. Capped at 3 per tenant (one default +
// two customized), matching what was actually asked for — this isn't a
// general-purpose limit, just enough to keep the settings page simple.

import { prisma } from "@/lib/db";
import { PDF_STYLES } from "@/lib/pdf/styles";

const MAX_TEMPLATES_PER_TENANT = 3;

export async function listPdfTemplates(tenantId: string) {
  return prisma.tenantPdfTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

export async function createPdfTemplate(params: {
  tenantId: string;
  name: string;
  styleKey: string;
  accentColorHex?: string;
  logoDataUrl?: string;
  isDefault?: boolean;
}) {
  if (!PDF_STYLES[params.styleKey]) throw new Error("Unknown template style.");

  const existingCount = await prisma.tenantPdfTemplate.count({ where: { tenantId: params.tenantId } });
  if (existingCount >= MAX_TEMPLATES_PER_TENANT) {
    throw new Error(`You can save up to ${MAX_TEMPLATES_PER_TENANT} PDF templates (one default + two customized).`);
  }

  if (params.isDefault || existingCount === 0) {
    await prisma.tenantPdfTemplate.updateMany({ where: { tenantId: params.tenantId }, data: { isDefault: false } });
  }

  return prisma.tenantPdfTemplate.create({
    data: {
      tenantId: params.tenantId,
      name: params.name,
      styleKey: params.styleKey,
      accentColorHex: params.accentColorHex,
      logoDataUrl: params.logoDataUrl,
      isDefault: params.isDefault || existingCount === 0,
    },
  });
}

export async function setDefaultPdfTemplate(tenantId: string, templateId: string) {
  await prisma.tenantPdfTemplate.updateMany({ where: { tenantId }, data: { isDefault: false } });
  return prisma.tenantPdfTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
}

export async function deletePdfTemplate(tenantId: string, templateId: string) {
  const template = await prisma.tenantPdfTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (template.tenantId !== tenantId) throw new Error("Not found.");
  await prisma.tenantPdfTemplate.delete({ where: { id: templateId } });

  if (template.isDefault) {
    const another = await prisma.tenantPdfTemplate.findFirst({ where: { tenantId } });
    if (another) await prisma.tenantPdfTemplate.update({ where: { id: another.id }, data: { isDefault: true } });
  }
}
