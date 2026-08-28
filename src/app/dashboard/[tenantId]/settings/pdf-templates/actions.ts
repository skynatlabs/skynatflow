"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createPdfTemplate, setDefaultPdfTemplate, deletePdfTemplate } from "@/lib/core/pdfTemplates";

export async function createPdfTemplateAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  assertCan(access.role, "staff:manage");

  const name = String(formData.get("name") ?? "").trim();
  const styleKey = String(formData.get("styleKey") ?? "");
  const accentColorHex = String(formData.get("accentColorHex") ?? "").trim() || undefined;
  if (!name || !styleKey) throw new Error("Name and style are required.");

  await createPdfTemplate({ tenantId, name, styleKey, accentColorHex });
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
