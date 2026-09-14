// Tenant-owned PDF templates — pick a base style (PDF_STYLES), optionally
// override its accent color/logo, and mark one as the default used for
// every quote/invoice/slip PDF. Capped at 3 per tenant (one default +
// two customized), matching what was actually asked for — this isn't a
// general-purpose limit, just enough to keep the settings page simple.

import { prisma } from "@/lib/db";
import { PDF_STYLES } from "@/lib/pdf/styles";
import { SECTION_BY_KEY, type SectionConfig } from "@/lib/pdf/sections";
import { PRESET_BY_KEY, sectionsFromPreset } from "@/lib/pdf/presets";

// Raised from 3. The old cap existed because a template was little more than
// a style key and an accent colour, so three covered it. Now that a template
// is a full section-by-section layout, a workspace legitimately wants one per
// document kind plus variants — and hitting a wall at three is the kind of
// limit that makes a product feel like a demo.
const MAX_TEMPLATES_PER_TENANT = 12;

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

async function requireOwnedTemplate(tenantId: string, templateId: string) {
  const template = await prisma.tenantPdfTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.tenantId !== tenantId) throw new Error("Template not found.");
  return template;
}

export async function setDefaultPdfTemplate(tenantId: string, templateId: string) {
  await requireOwnedTemplate(tenantId, templateId);
  await prisma.tenantPdfTemplate.updateMany({ where: { tenantId }, data: { isDefault: false } });
  return prisma.tenantPdfTemplate.update({ where: { id: templateId }, data: { isDefault: true } });
}

export async function updateSectionLayout(params: {
  tenantId: string;
  templateId: string;
  sectionOrder: string[];
  hiddenSections: string[];
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: { sectionOrder: params.sectionOrder, hiddenSections: params.hiddenSections },
  });
}

export async function updateStyleOverrides(params: {
  tenantId: string;
  templateId: string;
  fontFamily?: string;
  headerLayout?: string;
  tableHeaderStyle?: string;
  logoShape?: string;
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: {
      fontFamily: params.fontFamily || null,
      headerLayout: params.headerLayout || null,
      tableHeaderStyle: params.tableHeaderStyle || null,
      logoShape: params.logoShape || null,
    },
  });
}

export async function deletePdfTemplate(tenantId: string, templateId: string) {
  const template = await requireOwnedTemplate(tenantId, templateId);
  await prisma.tenantPdfTemplate.delete({ where: { id: templateId } });

  if (template.isDefault) {
    const another = await prisma.tenantPdfTemplate.findFirst({ where: { tenantId } });
    if (another) await prisma.tenantPdfTemplate.update({ where: { id: another.id }, data: { isDefault: true } });
  }
}

/**
 * Saves the section-by-section layout.
 *
 * Validated against the catalogue rather than trusted: the payload comes from
 * a form post, and an unknown key or a hidden locked section would be stored
 * happily and then quietly change what every future document looks like.
 */
export async function saveSections(params: {
  tenantId: string;
  templateId: string;
  sections: SectionConfig[];
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);

  const clean: SectionConfig[] = [];
  const seen = new Set<string>();

  for (const section of params.sections) {
    const def = SECTION_BY_KEY[section.key];
    if (!def || seen.has(section.key)) continue;
    seen.add(section.key);

    clean.push({
      key: section.key,
      visible: def.locked ? true : section.visible !== false,
      title: typeof section.title === "string" ? section.title.slice(0, 80) : undefined,
      body: typeof section.body === "string" ? section.body.slice(0, 2000) : undefined,
      align:
        section.align === "center" || section.align === "right" || section.align === "left"
          ? section.align
          : undefined,
      fields: def.fields
        ? Object.fromEntries(
            def.fields.map((f) => [f.key, section.fields?.[f.key] ?? f.default])
          )
        : undefined,
    });
  }

  if (clean.length === 0) throw new Error("A template needs at least one section.");

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: { sections: JSON.parse(JSON.stringify(clean)) },
  });
}

const PAGE_SIZES = new Set(["A5", "A4", "LETTER"]);
const ORIENTATIONS = new Set(["portrait", "landscape"]);

/** Margins are in inches; anything beyond this leaves no page to print on. */
function cleanMargin(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(3, Math.max(0, Math.round(value * 100) / 100));
}
const PAGE_MARGIN_KEYS = new Set(["compact", "normal", "roomy"]);
const APPLIES_TO = new Set(["ALL", "QUOTE", "INVOICE", "SLIP"]);

function cleanHex(value: string | undefined): string | null {
  if (!value) return null;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

/** Everything about a template that isn't its section list. */
export async function updateTemplateSettings(params: {
  tenantId: string;
  templateId: string;
  name?: string;
  styleKey?: string;
  accentColorHex?: string;
  textColorHex?: string;
  mutedColorHex?: string;
  fontFamily?: string;
  headerLayout?: string;
  tableHeaderStyle?: string;
  logoShape?: string;
  fontScale?: number;
  pageSize?: string;
  orientation?: string;
  pageMargin?: string;
  marginTopIn?: number;
  marginBottomIn?: number;
  marginLeftIn?: number;
  marginRightIn?: number;
  backgroundHex?: string;
  appliesTo?: string;
  logoDataUrl?: string | null;
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);
  if (params.styleKey && !PDF_STYLES[params.styleKey]) throw new Error("Unknown template style.");

  const scale =
    typeof params.fontScale === "number" && Number.isFinite(params.fontScale)
      ? Math.min(1.25, Math.max(0.85, params.fontScale))
      : null;

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: {
      ...(params.name ? { name: params.name.slice(0, 80) } : {}),
      ...(params.styleKey ? { styleKey: params.styleKey } : {}),
      accentColorHex: cleanHex(params.accentColorHex),
      textColorHex: cleanHex(params.textColorHex),
      mutedColorHex: cleanHex(params.mutedColorHex),
      fontFamily: params.fontFamily || null,
      headerLayout: params.headerLayout || null,
      tableHeaderStyle: params.tableHeaderStyle || null,
      logoShape: params.logoShape || null,
      fontScale: scale,
      pageSize: params.pageSize && PAGE_SIZES.has(params.pageSize) ? params.pageSize : null,
      orientation:
        params.orientation && ORIENTATIONS.has(params.orientation) ? params.orientation : null,
      marginTopIn: cleanMargin(params.marginTopIn),
      marginBottomIn: cleanMargin(params.marginBottomIn),
      marginLeftIn: cleanMargin(params.marginLeftIn),
      marginRightIn: cleanMargin(params.marginRightIn),
      backgroundHex: cleanHex(params.backgroundHex),
      pageMargin:
        params.pageMargin && PAGE_MARGIN_KEYS.has(params.pageMargin) ? params.pageMargin : null,
      appliesTo: params.appliesTo && APPLIES_TO.has(params.appliesTo) ? params.appliesTo : "ALL",
      // undefined leaves the stored logo alone; null clears it deliberately.
      ...(params.logoDataUrl === undefined ? {} : { logoDataUrl: params.logoDataUrl }),
    },
  });
}

/** Roughly 1MB of base64 — enough for a real logo, small enough to embed. */
const MAX_LOGO_BYTES = 1_400_000;

export async function setTemplateLogo(params: {
  tenantId: string;
  templateId: string;
  dataUrl: string;
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);

  if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(params.dataUrl)) {
    throw new Error("Use a PNG or JPG image.");
  }
  if (params.dataUrl.length > MAX_LOGO_BYTES) {
    throw new Error("That image is too large — keep it under about 1MB.");
  }

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: { logoDataUrl: params.dataUrl },
  });
}

/**
 * Applies a ready-made design.
 *
 * Writes the structure and the style settings together — a preset that set
 * the sections but left the old colours and header layout in place would
 * produce something that is neither design.
 */
export async function applyPreset(params: {
  tenantId: string;
  templateId: string;
  presetKey: string;
}) {
  await requireOwnedTemplate(params.tenantId, params.templateId);

  const preset = PRESET_BY_KEY[params.presetKey];
  if (!preset) throw new Error("Unknown design.");

  const sections = sectionsFromPreset(preset);
  const settings = preset.settings;

  return prisma.tenantPdfTemplate.update({
    where: { id: params.templateId },
    data: {
      sections: JSON.parse(JSON.stringify(sections)),
      styleKey: settings.styleKey,
      headerLayout: settings.headerLayout ?? null,
      tableHeaderStyle: settings.tableHeaderStyle ?? null,
      fontFamily: settings.fontFamily ?? null,
      logoShape: settings.logoShape ?? null,
      accentColorHex: settings.accentColorHex ?? null,
      textColorHex: settings.textColorHex ?? null,
      mutedColorHex: settings.mutedColorHex ?? null,
      pageMargin: settings.pageMargin ?? null,
      fontScale: settings.fontScale ?? null,
      appliesTo: settings.appliesTo ?? "ALL",
    },
  });
}
