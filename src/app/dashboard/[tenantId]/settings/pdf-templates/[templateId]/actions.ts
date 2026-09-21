"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  applyPreset,
  saveSections,
  setTemplateLogo,
  updateTemplateSettings,
} from "@/lib/core/pdfTemplates";
import { SECTION_BY_KEY, type SectionConfig } from "@/lib/pdf/sections";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // How every document from this business looks is an owner-level decision,
  // not something any signed-in staff member should be able to rewrite.
  assertCan(access, "staff:manage");
  return access;
}

function refresh(tenantId: string, templateId: string) {
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates/${templateId}`);
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates`);
}

/**
 * Saves the whole section list in one post.
 *
 * The client sends JSON rather than a field per section: order, visibility,
 * headings, body text and per-field switches all change together, and saving
 * them piecemeal would let a half-applied layout exist.
 */
export async function saveSectionsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("sections") ?? "[]"));
  } catch {
    throw new Error("Couldn't read that layout.");
  }
  if (!Array.isArray(parsed)) throw new Error("Couldn't read that layout.");

  const sections = parsed.filter(
    (s): s is SectionConfig =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { key?: unknown }).key === "string" &&
      SECTION_BY_KEY[(s as { key: string }).key] !== undefined
  );

  await saveSections({ tenantId, templateId, sections });
  refresh(tenantId, templateId);
}

export async function saveTemplateSettingsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  const scaleRaw = Number(formData.get("fontScale"));
  const inches = (key: string) => {
    const raw = formData.get(key);
    if (raw === null || String(raw).trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  await updateTemplateSettings({
    tenantId,
    templateId,
    name: String(formData.get("name") ?? "").trim() || undefined,
    styleKey: String(formData.get("styleKey") ?? "") || undefined,
    accentColorHex: String(formData.get("accentColorHex") ?? "") || undefined,
    textColorHex: String(formData.get("textColorHex") ?? "") || undefined,
    mutedColorHex: String(formData.get("mutedColorHex") ?? "") || undefined,
    fontFamily: String(formData.get("fontFamily") ?? ""),
    headerLayout: String(formData.get("headerLayout") ?? ""),
    tableHeaderStyle: String(formData.get("tableHeaderStyle") ?? ""),
    logoShape: String(formData.get("logoShape") ?? ""),
    fontScale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : undefined,
    pageSize: String(formData.get("pageSize") ?? ""),
    orientation: String(formData.get("orientation") ?? ""),
    pageMargin: String(formData.get("pageMargin") ?? ""),
    marginTopIn: inches("marginTopIn"),
    marginBottomIn: inches("marginBottomIn"),
    marginLeftIn: inches("marginLeftIn"),
    marginRightIn: inches("marginRightIn"),
    backgroundHex: String(formData.get("backgroundHex") ?? "") || undefined,
    appliesTo: String(formData.get("appliesTo") ?? "ALL"),
  });
  refresh(tenantId, templateId);
}

export async function saveLogoAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  const dataUrl = String(formData.get("logoDataUrl") ?? "");
  if (!dataUrl) {
    // An empty post is "remove the logo", which needs to be possible — a logo
    // you can add and never take off is a trap.
    await updateTemplateSettings({ tenantId, templateId, logoDataUrl: null });
  } else {
    await setTemplateLogo({ tenantId, templateId, dataUrl });
  }
  refresh(tenantId, templateId);
}

/**
 * The business details that print on every document.
 *
 * Workspace-wide rather than per-template — a business has one address and one
 * VAT number — but edited here because this is where you find out they are
 * missing.
 */
export async function saveBusinessDetailsAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      businessAddress: text("businessAddress"),
      businessEmail: text("businessEmail"),
      businessPhone: text("businessPhone"),
      vatNumber: text("vatNumber"),
      registrationNumber: text("registrationNumber"),
    },
  });
  refresh(tenantId, templateId);
}

export async function applyPresetAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  await applyPreset({
    tenantId,
    templateId,
    presetKey: String(formData.get("presetKey") ?? ""),
  });
  refresh(tenantId, templateId);
}

/**
 * One Save for the whole template.
 *
 * The editor holds every control in one piece of state, so saving has to be
 * one write: with a form per card you can change the margins, change the
 * table, save one of them and leave the document in a shape you never chose.
 */
export async function saveTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  await guard(tenantId);

  let payload: {
    settings?: Record<string, unknown>;
    sections?: unknown;
    business?: Record<string, string>;
  };
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    throw new Error("Couldn't read those changes.");
  }

  const settings = payload.settings ?? {};
  const str = (key: string) =>
    typeof settings[key] === "string" ? (settings[key] as string) : undefined;
  const num = (key: string) =>
    typeof settings[key] === "number" && Number.isFinite(settings[key] as number)
      ? (settings[key] as number)
      : undefined;

  await updateTemplateSettings({
    tenantId,
    templateId,
    name: str("name"),
    styleKey: str("styleKey"),
    appliesTo: str("appliesTo"),
    accentColorHex: str("accentColorHex"),
    textColorHex: str("textColorHex"),
    mutedColorHex: str("mutedColorHex"),
    backgroundHex: str("backgroundHex"),
    fontFamily: str("fontFamily") ?? "",
    headerLayout: str("headerLayout") ?? "",
    tableHeaderStyle: str("tableHeaderStyle") ?? "",
    logoShape: str("logoShape") ?? "",
    fontScale: num("fontScale"),
    pageSize: str("pageSize") ?? "",
    orientation: str("orientation") ?? "",
    pageMargin: str("pageMargin") ?? "",
    marginTopIn: num("marginTopIn"),
    marginBottomIn: num("marginBottomIn"),
    marginLeftIn: num("marginLeftIn"),
    marginRightIn: num("marginRightIn"),
  });

  if (Array.isArray(payload.sections)) {
    const sections = payload.sections.filter(
      (x): x is SectionConfig =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as { key?: unknown }).key === "string" &&
        SECTION_BY_KEY[(x as { key: string }).key] !== undefined
    );
    if (sections.length > 0) await saveSections({ tenantId, templateId, sections });
  }

  // Workspace-wide, but edited here because this is where you notice they are
  // missing from your documents.
  if (payload.business) {
    const b = payload.business;
    const text = (key: string) => (b[key] ?? "").trim() || null;
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        businessAddress: text("businessAddress"),
        businessEmail: text("businessEmail"),
        businessPhone: text("businessPhone"),
        vatNumber: text("vatNumber"),
        registrationNumber: text("registrationNumber"),
      },
    });
  }

  refresh(tenantId, templateId);
}
