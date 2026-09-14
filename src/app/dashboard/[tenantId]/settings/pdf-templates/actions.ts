"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import {
  applyPreset,
  createPdfTemplate,
  setDefaultPdfTemplate,
  deletePdfTemplate,
} from "@/lib/core/pdfTemplates";
import { PRESET_BY_KEY } from "@/lib/pdf/presets";

export async function createPdfTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const name = String(formData.get("name") ?? "").trim();
  const presetKey = String(formData.get("presetKey") ?? "");
  const preset = PRESET_BY_KEY[presetKey];
  if (!name) throw new Error("Give the template a name.");
  if (!preset) throw new Error("Pick a design to start from.");

  // A new template starts as a finished design rather than as a style key and
  // nothing else. Picking "Minimal Mono" from a dropdown told nobody what
  // they were about to get.
  const created = await createPdfTemplate({
    tenantId,
    name,
    styleKey: preset.settings.styleKey,
  });
  await applyPreset({ tenantId, templateId: created.id, presetKey });

  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates`);
}

export async function setDefaultPdfTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await setDefaultPdfTemplate(tenantId, String(formData.get("templateId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates`);
}

export async function deletePdfTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  await deletePdfTemplate(tenantId, String(formData.get("templateId") ?? ""));
  revalidatePath(`/dashboard/${tenantId}/settings/pdf-templates`);
}
